import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { SignJWT } from "jose"

import { db } from "@/lib/db"
import {
  chatConversations,
  chatConversationMembers,
  checkinTasks,
  communityComments,
  communityPosts,
  notices,
  persons,
  pushDeliveries,
  pushDevices,
  users,
} from "@/lib/db/schema"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export function installationHash(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}
export function ownsInstallation(hash: string, secret: string) {
  const expected = Buffer.from(hash, "hex")
  const actual = Buffer.from(installationHash(secret), "hex")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function registerPushDevice(
  userId: string,
  input: {
    installationId: string
    secret: string
    providerToken?: string | null
    enabled: boolean
    noticesEnabled?: boolean
    tasksEnabled?: boolean
    chatEnabled?: boolean
    communityEnabled?: boolean
    checkinRemindersEnabled?: boolean
  },
) {
  return db.transaction(async (tx) => {
    // Serialize rebinding and provider-token rotation across sessions/installations.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('push-device-registration'))`,
    )
    const [account] = await tx
      .select({ version: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!account) throw new Error("账号不可用")
    const [existing] = await tx
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.installationId, input.installationId))
      .limit(1)
      .for("update")
    if (existing && !ownsInstallation(existing.secretHash, input.secret))
      return null
    const token = input.providerToken ?? null
    if (token)
      await tx
        .update(pushDevices)
        .set({
          providerToken: null,
          enabled: false,
          bindingId: randomUUID(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pushDevices.providerToken, token),
            ne(pushDevices.installationId, input.installationId),
          ),
        )
    const changed =
      !existing ||
      existing.userId !== userId ||
      existing.tokenVersion !== account.version ||
      existing.providerToken !== token ||
      existing.enabled !== input.enabled
    const values = {
      userId,
      tokenVersion: account.version,
      providerToken: token,
      enabled: input.enabled,
      noticesEnabled: input.noticesEnabled ?? existing?.noticesEnabled ?? true,
      tasksEnabled: input.tasksEnabled ?? existing?.tasksEnabled ?? true,
      chatEnabled: input.chatEnabled ?? existing?.chatEnabled ?? true,
      communityEnabled:
        input.communityEnabled ?? existing?.communityEnabled ?? true,
      checkinRemindersEnabled:
        input.checkinRemindersEnabled ??
        existing?.checkinRemindersEnabled ??
        false,
      bindingId: changed ? randomUUID() : existing.bindingId,
      updatedAt: new Date(),
    }
    const [device] = existing
      ? await tx
          .update(pushDevices)
          .set(values)
          .where(eq(pushDevices.id, existing.id))
          .returning()
      : await tx
          .insert(pushDevices)
          .values({
            ...values,
            installationId: input.installationId,
            secretHash: installationHash(input.secret),
          })
          .returning()
    return { id: device!.id, bindingId: device!.bindingId }
  })
}

export async function deviceRealtimeToken(
  userId: string,
  deviceId: string,
  secret: string,
) {
  const [device] = await db
    .select({ device: pushDevices, account: users })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(
      and(
        eq(pushDevices.id, deviceId),
        eq(pushDevices.userId, userId),
        eq(pushDevices.enabled, true),
      ),
    )
    .limit(1)
  if (
    !device ||
    !ownsInstallation(device.device.secretHash, secret) ||
    device.account.status !== "active" ||
    device.account.tokenVersion !== device.device.tokenVersion
  )
    return null
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) throw new Error("AUTH_SECRET missing")
  return new SignJWT({
    purpose: "app-notifications",
    deviceId,
    bindingId: device.device.bindingId,
    tokenVersion: device.account.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authSecret))
}

export async function enqueueChatNotifications(
  tx: Tx,
  messageId: string,
  conversationId: string,
  senderId: string,
) {
  const [conversation] = await tx
    .select({
      type: chatConversations.type,
      roomOrganizationId: chatConversations.roomOrganizationId,
    })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)
  if (!conversation) return

  let memberIds: string[]
  if (conversation.type === "ROOM" && conversation.roomOrganizationId) {
    const roomMembers = await tx
      .select({ id: users.id })
      .from(persons)
      .innerJoin(users, eq(users.id, persons.userId))
      .where(
        and(
          eq(persons.organizationId, conversation.roomOrganizationId),
          eq(persons.personType, "SUPERVISED"),
          eq(persons.status, "active"),
          eq(users.status, "active"),
        ),
      )
    memberIds = roomMembers.map((member) => member.id)
  } else {
    const members = await tx
      .select({ id: chatConversationMembers.userId })
      .from(chatConversationMembers)
      .where(
        and(
          eq(chatConversationMembers.conversationId, conversationId),
          isNull(chatConversationMembers.leftAt),
        ),
      )
    memberIds = members.map((member) => member.id)
  }
  const recipientIds = memberIds.filter((id) => id !== senderId)
  if (!recipientIds.length) return
  const devices = await tx
    .select()
    .from(pushDevices)
    .where(
      and(
        inArray(pushDevices.userId, recipientIds),
        eq(pushDevices.enabled, true),
        eq(pushDevices.chatEnabled, true),
        sql`not exists (select 1 from chat_notification_preferences p where p.user_id=${pushDevices.userId} and p.conversation_id=${conversationId}::uuid and p.muted)`,
      ),
    )
  if (!devices.length) return
  await tx
    .insert(pushDeliveries)
    .values(
      devices.map((device) => ({
        deviceId: device.id,
        userId: device.userId,
        bindingId: device.bindingId,
        eventKey: `CHAT:${messageId}`,
        kind: "CHAT",
        entityId: messageId,
        conversationId,
      })),
    )
    .onConflictDoNothing()
  await tx.execute(sql`select pg_notify('custodysim_push', 'ready')`)
}

/** Only the post owner receives replies; no commenter identity enters the queue. */
export async function enqueueCommunityComment(tx: Tx, commentId: string) {
  const [entry] = await tx
    .select({
      ownerId: communityPosts.authorId,
      commenterId: communityComments.authorId,
    })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .where(eq(communityComments.id, commentId))
    .limit(1)
  if (!entry || entry.ownerId === entry.commenterId) return
  const devices = await tx
    .select()
    .from(pushDevices)
    .where(
      and(
        eq(pushDevices.userId, entry.ownerId),
        eq(pushDevices.enabled, true),
        eq(pushDevices.communityEnabled, true),
      ),
    )
  if (!devices.length) return
  await tx
    .insert(pushDeliveries)
    .values(
      devices.map((device) => ({
        deviceId: device.id,
        userId: device.userId,
        bindingId: device.bindingId,
        kind: "COMMUNITY",
        entityId: commentId,
        eventKey: `COMMUNITY:${commentId}`,
      })),
    )
    .onConflictDoNothing()
  await tx.execute(sql`select pg_notify('custodysim_push', 'ready')`)
}

export async function enqueueNoticeNotifications(tx: Tx, noticeId: string) {
  const [notice] = await tx
    .select()
    .from(notices)
    .where(eq(notices.id, noticeId))
    .limit(1)
  if (
    !notice?.published ||
    (notice.expiresAt && notice.expiresAt <= new Date())
  )
    return
  const devices = await tx
    .select({ device: pushDevices })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(
      and(
        eq(pushDevices.enabled, true),
        eq(users.status, "active"),
        eq(pushDevices.noticesEnabled, true),
        notice.targetRole === "ALL"
          ? undefined
          : eq(users.role, notice.targetRole as typeof users.$inferSelect.role),
      ),
    )
  if (!devices.length) return
  await tx
    .insert(pushDeliveries)
    .values(
      devices.map(({ device }) => ({
        deviceId: device.id,
        userId: device.userId,
        bindingId: device.bindingId,
        eventKey: `NOTICE:${noticeId}:${notice.updatedAt.toISOString()}`,
        kind: "NOTICE",
        entityId: noticeId,
      })),
    )
    .onConflictDoNothing()
  await tx.execute(sql`select pg_notify('custodysim_push', 'ready')`)
}

/**
 * Runs after task generation, leave auto-approval and expiry reconciliation.
 *
 * 和打卡提醒同一套口径：判定依据是"这条 event_key 还没排过队"，而不是
 * "现在是否还在某个窄时间窗内"——巡检漏掉一轮、进程重启、部署期间都能在
 * 下一轮补上，不会静默丢失。
 */
export async function enqueueTaskNotifications(now = new Date()) {
  await db.execute(sql`
    insert into push_deliveries (device_id,user_id,binding_id,event_key,kind,entity_id)
    select d.id,t.supervised_id,d.binding_id,
      'TASK:'||t.id||':'||event.stage||case when event.stage in ('RETURNED','APPROVED') then ':'||to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else '' end,
      'TASK',t.id
    from report_tasks t
    join users u on u.id=t.supervised_id and u.status='active' and u.role='SUPERVISED'
    join push_devices d on d.user_id=u.id and d.enabled and d.tasks_enabled and d.token_version=u.token_version
    cross join lateral (select case
      -- 审核结果：窗口放宽到 24 小时，事件键带 updated_at，同一版本只发一次
      when t.status in ('RETURNED','APPROVED') and t.updated_at>${now}::timestamptz-interval '24 hours' then t.status
      -- 截止提醒：提前量随时长缩放并夹在 30 分钟～2 小时之间。
      -- 下限保证短任务也有提醒，上限避免 15 小时任务的"截止带"长达 3 小时。
      when t.status in ('PENDING','RETURNED')
        and t.deadline-${now}::timestamptz<=greatest(interval '30 minutes',
          least(interval '2 hours',(t.deadline-t.schedule_at)*0.2)) then 'CLOSING'
      -- 新任务：24 小时内进入过时段就补发一次；只发第一条，已发过截止提醒的不再回头补
      when t.status='PENDING'
        and greatest(t.created_at,t.schedule_at)>${now}::timestamptz-interval '24 hours'
        and not exists (select 1 from push_deliveries pd0
          where pd0.device_id=d.id and pd0.kind='TASK' and pd0.entity_id=t.id) then 'OPEN'
    end as stage) event
    where event.stage is not null and t.schedule_at<=${now}::timestamptz
      and (t.status='APPROVED' or t.deadline>${now}::timestamptz)
      and (t.rule_id is null or exists (select 1 from rules r where r.id=t.rule_id and r.enabled))
      and not exists (select 1 from persons p where p.user_id=u.id and p.custody_status='ON_LEAVE'
        and t.template_snapshot->>'completionMode' is distinct from 'READING')
      and not exists (select 1 from push_deliveries pd
        where pd.device_id=d.id and pd.kind='TASK' and pd.entity_id=t.id
          and pd.event_key='TASK:'||t.id||':'||event.stage||case when event.stage in ('RETURNED','APPROVED') then ':'||to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else '' end)
    on conflict (device_id,event_key) do nothing
  `)
}

/** Called with one user's tasks, filtered through current rule scopes by the scheduler. */
export async function enqueueCheckinReminders(
  tasks: (typeof checkinTasks.$inferSelect)[],
  now: Date,
) {
  const due = tasks.filter(
    (task) =>
      task.status === "PENDING" &&
      task.scheduleAt <= now &&
      task.deadline > now,
  )
  if (!due.length) return
  const devices = await db
    .select()
    .from(pushDevices)
    .where(
      and(
        eq(pushDevices.userId, due[0]!.supervisedId),
        eq(pushDevices.enabled, true),
        eq(pushDevices.checkinRemindersEnabled, true),
      ),
    )
  if (!devices.length) return
  /*
   * 以"这条提醒发过没有"为准，而不是"现在是否还在某个时间窗内"。
   *
   * 旧口径要求 OPEN 必须在时段开始后 10 分钟内被抓到：轮询一旦错过（重启、
   * 慢查询、事件循环阻塞），该时段就永远没有提醒，也不会补发。
   */
  const queued = new Set(
    (
      await db
        .select({ eventKey: pushDeliveries.eventKey })
        .from(pushDeliveries)
        .where(
          and(
            inArray(
              pushDeliveries.deviceId,
              devices.map((device) => device.id),
            ),
            inArray(
              pushDeliveries.entityId,
              due.map((task) => task.id),
            ),
          ),
        )
    ).map((row) => row.eventKey),
  )
  const values = due.flatMap((task) => {
    const window = task.deadline.getTime() - task.scheduleAt.getTime()
    const remaining = task.deadline.getTime() - now.getTime()
    // 截止提醒的提前量随时段长度缩放：短时段 5 分钟，长时段 20%。
    const closingWindow = Math.max(5 * 60_000, window * 0.2)
    const openSent = queued.has(`CHECKIN:${task.id}:OPEN`)
    const closingSent = queued.has(`CHECKIN:${task.id}:CLOSING`)
    /*
     * 每个时段最多两条：先 OPEN 再 CLOSING，或直接在截止带里发 CLOSING。
     * CLOSING 一旦发过就不再回头补 OPEN——否则迟到的时段会先收"开始提醒"，
     * 再收"截止提醒"，两条都没有意义。
     */
    const stage = closingSent
      ? null
      : remaining <= closingWindow
        ? "CLOSING"
        : openSent
          ? null
          : "OPEN"
    return stage
      ? devices.map((device) => ({
          deviceId: device.id,
          userId: device.userId,
          bindingId: device.bindingId,
          eventKey: `CHECKIN:${task.id}:${stage}`,
          kind: "CHECKIN",
          entityId: task.id,
        }))
      : []
  })
  if (values.length)
    await db.transaction(async (tx) => {
      await tx.insert(pushDeliveries).values(values).onConflictDoNothing()
      await tx.execute(sql`select pg_notify('custodysim_push', 'ready')`)
    })
}
