import { createHash } from "node:crypto"
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"
import type { SessionUser } from "@/lib/session"
import { db } from "@/lib/db"
import {
  auditLogs,
  loginRateLimits,
  organizations,
  persons,
  pushDevices,
  refreshTokens,
  registrationEmailBlocks,
  registrations,
  registrationSettings,
  registrationRiskBlocks,
  users,
} from "@/lib/db/schema"
import { hashPassword } from "@/lib/auth"
import { computePasswordMeta, validatePassword } from "@/lib/password-rule"
import { revokeTrustedDevicesInTransaction } from "@/lib/mfa-server"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"
import {
  registrationNetwork,
  REGISTRATION_DEVICE_LIMIT,
  REGISTRATION_DEVICE_WINDOW_MS,
  type RegistrationRisk,
} from "@/lib/registration-browser"
import {
  passesProbation,
  probationPeriod,
  REGISTRATION_ATTEMPTS,
  REGISTRATION_GRACE_MS,
  REGISTRATION_WINDOW_MS,
  registrationEmailHash,
  RegistrationSchema,
} from "@/lib/registration-policy"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export class RegistrationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(message)
  }
}
export async function getRegistrationSettings() {
  await db.insert(registrationSettings).values({ id: 1 }).onConflictDoNothing()
  return (
    await db
      .select()
      .from(registrationSettings)
      .where(eq(registrationSettings.id, 1))
  )[0]!
}

/** Count all attempts, including successes, atomically across workers. */
export async function consumeRegistrationAttempt(
  ip: string | null,
  now = new Date(),
) {
  const key = createHash("sha256")
    .update(`registration:network:${registrationNetwork(ip) ?? "unknown"}`)
    .digest("hex")
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`registration-rate:${key}`}))`,
    )
    const [entry] = await tx
      .select()
      .from(loginRateLimits)
      .where(eq(loginRateLimits.key, key))
    const fresh =
      !entry ||
      now.getTime() - entry.windowStartedAt.getTime() >= REGISTRATION_WINDOW_MS
    if (!fresh && entry.attemptCount >= REGISTRATION_ATTEMPTS)
      return Math.ceil(
        (entry.windowStartedAt.getTime() +
          REGISTRATION_WINDOW_MS -
          now.getTime()) /
          1000,
      )
    await tx
      .insert(loginRateLimits)
      .values({ key, attemptCount: 1, windowStartedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: loginRateLimits.key,
        set: {
          attemptCount: fresh ? 1 : entry.attemptCount + 1,
          windowStartedAt: fresh ? now : entry.windowStartedAt,
          updatedAt: now,
        },
      })
    return 0
  })
}

async function defaultRoom(tx: Tx, configured: string | null) {
  if (configured) {
    const [room] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, configured))
    if (room?.category !== "ROOM")
      throw new RegistrationError("注册监室暂不可用，请联系管理员", 503)
    return configured
  }
  let parentId: string | null = null
  for (const [category, name] of [
    ["ROOT", "自主注册"],
    ["SUPERVISED_ROOT", "注册编制"],
    ["WARD", "新用户监区"],
    ["ROOM", "新用户监室"],
  ]) {
    const created: { id: string }[] = await tx
      .insert(organizations)
      .values({ name, category, parentId })
      .returning({ id: organizations.id })
    parentId = created[0]!.id
  }
  await tx
    .update(registrationSettings)
    .set({ organizationId: parentId })
    .where(eq(registrationSettings.id, 1))
  return parentId!
}

export async function createRegistration(
  input: z.infer<typeof RegistrationSchema>,
  now = new Date(),
  risk?: RegistrationRisk,
) {
  const passwordCheck = validatePassword(input.password)
  if (!passwordCheck.valid)
    throw new RegistrationError(passwordCheck.errors.join("；"))
  await getRegistrationSettings()
  const passwordHash = await hashPassword(input.password)
  const emailHash = registrationEmailHash(input.email)
  const period = probationPeriod(now)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('registration-mutations'))`,
    )
    const [settings] = await tx
      .select()
      .from(registrationSettings)
      .where(eq(registrationSettings.id, 1))
      .for("update")
    if (!settings?.enabled) throw new RegistrationError("当前暂未开放注册", 403)
    if (risk) await assertRegistrationRisk(risk, now, tx)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`registration-email:${emailHash}`}))`,
    )
    const [blocked] = await tx
      .select()
      .from(registrationEmailBlocks)
      .where(eq(registrationEmailBlocks.emailHash, emailHash))
    const [existingEmail] = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.emailHash, emailHash))
    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, input.username))
    if (blocked || existingEmail || existingUser)
      throw new RegistrationError("用户名或邮箱不可用", 409)
    const organizationId = await defaultRoom(tx, settings.organizationId)
    const [user] = await tx
      .insert(users)
      .values({
        username: input.username,
        name: input.name,
        passwordHash,
        passwordMeta: JSON.stringify(computePasswordMeta(input.password)),
        role: "SUPERVISED",
        status: "active",
        mustChangePassword: false,
        organizationId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id, username: users.username })
    await tx.insert(persons).values({
      userId: user.id,
      name: input.name,
      organizationId,
      personType: "SUPERVISED",
      custodyLevel: "GENERAL",
      custodyStatus: "IN_CUSTODY",
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(registrations).values({
      userId: user.id,
      emailHash,
      deviceHash: risk?.deviceHash ?? null,
      networkHash: risk?.networkHash ?? null,
      trialStart: period.start,
      trialEnd: period.end,
      createdAt: now,
    })
    await tx.insert(auditLogs).values({
      actorId: user.id,
      actorName: input.name,
      actorRole: "SUPERVISED",
      actorType: "USER",
      action: "REGISTER",
      actionLabel: "Web 自主注册",
      entityType: "user",
      entityId: user.id,
      detail: {
        trialStart: period.start.toISOString(),
        trialEnd: period.end.toISOString(),
      },
    })
    return { ...user, trialStart: period.start, trialEnd: period.end }
  })
}

/** Attribute delayed daily settlements to their business day, not the write timestamp. */
export async function probationScore(
  userId: string,
  start: Date,
  end: Date,
  executor: Pick<Tx, "execute"> = db,
) {
  const result = await executor.execute(sql`
    select coalesce(sum(e.points),0)::int as total from score_events e
    left join checkin_daily_scores d on e.source='CHECKIN_DAILY' and d.id=e.source_id and d.supervised_id=e.supervised_id
    left join report_tasks t on e.source='TASK_OUTCOME' and t.id=e.source_id and t.supervised_id=e.supervised_id
    where e.supervised_id=${userId}::uuid and case
      when e.source='CHECKIN_DAILY' then d.day_key>=${getShanghaiDateKey(start)} and d.day_key<${getShanghaiDateKey(end)}
      when e.source='TASK_OUTCOME' then t.schedule_at>=${start}::timestamptz and t.schedule_at<${end}::timestamptz
      else e.created_at>=${start}::timestamptz and e.created_at<${end}::timestamptz end
  `)
  return Number(result.rows[0]?.total ?? 0)
}

/** Both a preflight and a transaction-level check; the latter serializes concurrent signups. */
export async function assertRegistrationRisk(
  risk: RegistrationRisk,
  now = new Date(),
  executor: Pick<Tx, "select"> = db,
) {
  const [blocked] = await executor
    .select({ id: registrationRiskBlocks.id })
    .from(registrationRiskBlocks)
    .where(
      and(
        or(
          and(
            eq(registrationRiskBlocks.kind, "DEVICE"),
            eq(registrationRiskBlocks.valueHash, risk.deviceHash),
          ),
          risk.networkHash
            ? and(
                eq(registrationRiskBlocks.kind, "NETWORK"),
                eq(registrationRiskBlocks.valueHash, risk.networkHash),
              )
            : undefined,
        ),
        or(
          isNull(registrationRiskBlocks.expiresAt),
          gt(registrationRiskBlocks.expiresAt, now),
        ),
      ),
    )
    .limit(1)
  if (blocked)
    throw new RegistrationError(
      "当前注册请求受到限制，请稍后重试或联系管理员",
      403,
    )
  const recent = await executor
    .select({ createdAt: registrations.createdAt })
    .from(registrations)
    .where(
      and(
        eq(registrations.deviceHash, risk.deviceHash),
        gte(
          registrations.createdAt,
          new Date(now.getTime() - REGISTRATION_DEVICE_WINDOW_MS),
        ),
      ),
    )
    .orderBy(asc(registrations.createdAt))
    .limit(REGISTRATION_DEVICE_LIMIT)
  if (recent.length >= REGISTRATION_DEVICE_LIMIT)
    throw new RegistrationError(
      "当前浏览器注册过于频繁，请稍后重试",
      429,
      Math.max(
        1,
        Math.ceil(
          (recent[0].createdAt.getTime() +
            REGISTRATION_DEVICE_WINDOW_MS -
            now.getTime()) /
            1000,
        ),
      ),
    )
}

async function recordRiskBlocks(
  tx: Tx,
  entry: typeof registrations.$inferSelect,
  reason: string,
  now: Date,
) {
  if (entry.deviceHash)
    await tx
      .insert(registrationRiskBlocks)
      .values({
        kind: "DEVICE",
        valueHash: entry.deviceHash,
        reason,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [registrationRiskBlocks.kind, registrationRiskBlocks.valueHash],
        set: { reason, expiresAt: null },
      })
  if (!entry.networkHash) return
  const [count] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(
      and(
        eq(registrations.networkHash, entry.networkHash),
        inArray(registrations.state, ["FAILED", "BLOCKED"]),
        gte(registrations.evaluatedAt, new Date(now.getTime() - 7 * 86400_000)),
      ),
    )
  // One person's failed probation must not permanently block a shared public IP.
  if (count.count >= 3) {
    const expiresAt = new Date(now.getTime() + 86400_000)
    await tx
      .insert(registrationRiskBlocks)
      .values({
        kind: "NETWORK",
        valueHash: entry.networkHash,
        reason: "同一网络近期多个注册账号被停用",
        expiresAt,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [registrationRiskBlocks.kind, registrationRiskBlocks.valueHash],
        set: { expiresAt, reason: "同一网络近期多个注册账号被停用" },
      })
  }
}

async function disableRegisteredUser(tx: Tx, userId: string, now: Date) {
  await tx
    .update(users)
    .set({
      status: "disabled",
      tokenVersion: sql`${users.tokenVersion}+1`,
      updatedAt: now,
    })
    .where(eq(users.id, userId))
  await tx
    .update(persons)
    .set({
      status: "inactive",
      custodyStatus: "OUT_OF_CUSTODY",
      updatedAt: now,
    })
    .where(eq(persons.userId, userId))
  await tx
    .update(pushDevices)
    .set({ enabled: false, updatedAt: now })
    .where(eq(pushDevices.userId, userId))
  await tx
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(eq(refreshTokens.userId, userId))
  await revokeTrustedDevicesInTransaction(tx, userId)
}

export async function blockRegistrationEmail(
  emailHash: string,
  reason: string,
  now = new Date(),
  actor?: SessionUser,
) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('registration-mutations'))`,
    )
    const [entry] = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.emailHash, emailHash))
      .for("update")
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`registration-email:${emailHash}`}))`,
    )
    await tx
      .insert(registrationEmailBlocks)
      .values({ emailHash, reason, createdAt: now })
      .onConflictDoUpdate({
        target: registrationEmailBlocks.emailHash,
        set: { reason },
      })
    if (entry) {
      await disableRegisteredUser(tx, entry.userId, now)
      await tx
        .update(registrations)
        .set({ state: "BLOCKED", evaluatedAt: now })
        .where(eq(registrations.userId, entry.userId))
      await recordRiskBlocks(tx, entry, reason, now)
    }
    await tx.insert(auditLogs).values({
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? "注册系统",
      actorRole: actor?.role ?? "SYSTEM",
      actorType: actor ? "USER" : "SYSTEM",
      action: "REGISTRATION_BLOCK",
      actionLabel: "拉黑注册邮箱并停用关联账号",
      entityType: "user",
      entityId: entry?.userId ?? null,
      detail: { reason },
    })
  })
}

export async function runRegistrationSweep(now = new Date()) {
  // Existing settlement routines remain authoritative; no parallel scoring formula.
  const { runCheckinDailyScoreSweep } = await import("@/lib/scoring")
  const { runReportTaskOutcomeSweep } = await import("@/lib/task-engine")
  const due = await db
    .select({ id: registrations.userId })
    .from(registrations)
    .where(
      and(
        eq(registrations.state, "PENDING"),
        lte(
          registrations.trialEnd,
          new Date(now.getTime() - REGISTRATION_GRACE_MS),
        ),
      ),
    )
    .limit(1)
  if (due.length) {
    await runCheckinDailyScoreSweep(now)
    await runReportTaskOutcomeSweep(now)
  }
  const count = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('registration-mutations'))`,
    )
    const entries = await tx
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.state, "PENDING"),
          lte(
            registrations.trialEnd,
            new Date(now.getTime() - REGISTRATION_GRACE_MS),
          ),
        ),
      )
      .limit(100)
      .for("update", { skipLocked: true })
    for (const entry of entries) {
      const [account] = await tx
        .select()
        .from(users)
        .where(eq(users.id, entry.userId))
        .for("update")
      if (!account || account.status !== "active") {
        await tx
          .update(registrations)
          .set({ state: "BLOCKED", evaluatedAt: now })
          .where(eq(registrations.userId, entry.userId))
        continue
      }
      const score = await probationScore(
        entry.userId,
        entry.trialStart,
        entry.trialEnd,
        tx,
      )
      const state = passesProbation(score) ? "PASSED" : "FAILED"
      await tx
        .update(registrations)
        .set({ state, finalScore: score, evaluatedAt: now })
        .where(eq(registrations.userId, entry.userId))
      if (state === "FAILED") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`registration-email:${entry.emailHash}`}))`,
        )
        await tx
          .insert(registrationEmailBlocks)
          .values({
            emailHash: entry.emailHash,
            reason: "首周考察积分未大于 0",
            createdAt: now,
          })
          .onConflictDoNothing()
        await disableRegisteredUser(tx, entry.userId, now)
        await recordRiskBlocks(tx, entry, "首周考察未通过", now)
      }
      await tx.insert(auditLogs).values({
        actorId: null,
        actorName: "注册考察系统",
        actorRole: "SYSTEM",
        actorType: "SYSTEM",
        action: "REGISTRATION_REVIEW",
        actionLabel:
          state === "PASSED" ? "首周考察通过" : "首周考察未通过，自动停用",
        entityType: "user",
        entityId: entry.userId,
        detail: { score, state },
      })
    }
    return entries.length
  })
  await db.execute(sql`
    insert into push_deliveries (device_id,user_id,binding_id,event_key,kind,entity_id)
    select d.id,r.user_id,d.binding_id,'PROBATION:'||r.user_id||':REMINDER','PROBATION',r.user_id
    from registrations r join users u on u.id=r.user_id and u.status='active'
    join push_devices d on d.user_id=r.user_id and d.enabled and d.notices_enabled and d.token_version=u.token_version
    where r.state='PENDING' and r.trial_end>${now}::timestamptz and r.trial_end<=${now}::timestamptz+interval '1 day'
    on conflict (device_id,event_key) do nothing
  `)
  return count
}

export function startRegistrationScheduler() {
  const key = Symbol.for("custodysim.registration-scheduler")
  const runtime = globalThis as typeof globalThis & {
    [key]?: ReturnType<typeof setInterval>
  }
  if (runtime[key]) return
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await runRegistrationSweep()
    } catch {
      console.error("[registration] probation sweep failed; retrying")
    } finally {
      running = false
    }
  }
  void run()
  const timer = setInterval(() => void run(), 5 * 60_000)
  timer.unref()
  runtime[key] = timer
}
