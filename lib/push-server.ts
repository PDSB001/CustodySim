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

/** Runs after task generation, leave auto-approval and expiry reconciliation. */
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
      when t.status in ('RETURNED','APPROVED') and t.updated_at>${now}::timestamptz-interval '10 minutes' then t.status
      when t.status='PENDING' and greatest(t.created_at,t.schedule_at)>${now}::timestamptz-interval '10 minutes' then 'OPEN'
      when t.status in ('PENDING','RETURNED') and t.deadline<=${now}::timestamptz+interval '30 minutes' and t.schedule_at<=${now}::timestamptz-interval '1 hour' then 'CLOSING'
    end as stage) event
    where event.stage is not null and t.schedule_at<=${now}::timestamptz
      and (t.status='APPROVED' or t.deadline>${now}::timestamptz)
      and (t.rule_id is null or exists (select 1 from rules r where r.id=t.rule_id and r.enabled))
      and not exists (select 1 from persons p where p.user_id=u.id and p.custody_status='ON_LEAVE'
        and t.template_snapshot->>'completionMode' is distinct from 'READING')
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
  const values = due.flatMap((task) => {
    const elapsed = now.getTime() - task.scheduleAt.getTime()
    const remaining = task.deadline.getTime() - now.getTime()
    // Short windows get one reminder; long windows also get a closing reminder.
    const stage =
      elapsed < 10 * 60_000
        ? "OPEN"
        : remaining <= 10 * 60_000 && elapsed >= 20 * 60_000
          ? "CLOSING"
          : null
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
