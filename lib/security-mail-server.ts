import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  emailVerificationChallenges as challenges,
  securityEmails,
  securityMailLimits,
  securityMailOutbox,
  securityMailSettings,
  users,
  mfaFactors,
  mfaLoginChallenges,
} from "@/lib/db/schema"
import { decryptMfaSecret, encryptMfaSecret, hashEmailCode } from "@/lib/mfa"
import {
  consumeMfaCodeInTransaction,
  revokeTrustedDevicesInTransaction,
} from "@/lib/mfa-server"
import { verifyPassword } from "@/lib/auth"
import {
  getSecurityMailConfig,
  maskSecurityEmail,
  sendSecurityMail,
  type SecurityMail,
} from "@/lib/security-mail"
import { writeAuditLog } from "@/lib/audit"
import type { SessionUser } from "@/lib/session"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export class EmailSecurityError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export async function getSecurityMailPolicy() {
  const [settings] = await db
    .select()
    .from(securityMailSettings)
    .where(eq(securityMailSettings.id, "default"))
  return {
    bindingEnabled: settings?.bindingEnabled ?? false,
    configured: getSecurityMailConfig().configured,
  }
}

async function reserveLimit(
  tx: Tx,
  scope: string,
  value: string,
  maximum: number,
  cooldown: number,
) {
  const key = createHash("sha256")
    .update(`security-mail:${scope}:${value}`)
    .digest("hex")
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
  const [row] = await tx
    .select()
    .from(securityMailLimits)
    .where(eq(securityMailLimits.key, key))
  const now = new Date()
  const reset =
    !row || now.getTime() - row.windowStartedAt.getTime() >= 3600_000
  if (
    row &&
    ((!reset && row.count >= maximum) ||
      now.getTime() - row.lastSentAt.getTime() < cooldown)
  )
    throw new EmailSecurityError("请求过于频繁，请稍后重试", 429)
  const values = {
    count: reset ? 1 : row!.count + 1,
    windowStartedAt: reset ? now : row!.windowStartedAt,
    lastSentAt: now,
  }
  await tx
    .insert(securityMailLimits)
    .values({ key, ...values })
    .onConflictDoUpdate({ target: securityMailLimits.key, set: values })
}

async function reserveEmailAttempts(
  userId: string,
  ip: string,
  kind: "send" | "verify",
  email?: string,
) {
  await db.transaction(async (tx) => {
    // Same lock order across all requests; limits count attempts, including failed credentials and delivery.
    await reserveLimit(
      tx,
      `${kind}:ip`,
      ip || "unknown",
      kind === "send" ? 20 : 100,
      0,
    )
    await reserveLimit(
      tx,
      `${kind}:user`,
      userId,
      kind === "send" ? 5 : 30,
      kind === "send" ? 60_000 : 0,
    )
    if (email)
      await reserveLimit(tx, "send:recipient", email.toLowerCase(), 5, 60_000)
  })
}

export async function queueSecurityNotice(
  tx: Tx,
  userId: string,
  event: string,
  to?: string,
) {
  if (!to) {
    const [bound] = await tx
      .select()
      .from(securityEmails)
      .where(eq(securityEmails.userId, userId))
    if (!bound) return
    to = decryptMfaSecret(bound.emailEncrypted)
  }
  const mail: SecurityMail = {
    to,
    kind: "notice",
    params: { event, time: new Date().toISOString() },
  }
  await tx
    .insert(securityMailOutbox)
    .values({
      userId,
      payloadEncrypted: encryptMfaSecret(JSON.stringify(mail)),
    })
}

export async function beginEmailBinding(
  actor: SessionUser,
  input: { email: string; password: string; code?: string },
  ip: string,
) {
  const policy = await getSecurityMailPolicy()
  if (!policy.bindingEnabled || !policy.configured)
    throw new EmailSecurityError("邮箱绑定服务尚未开启", 503)
  await reserveEmailAttempts(actor.id, ip, "send", input.email)
  const [account] = await db.select().from(users).where(eq(users.id, actor.id))
  if (!account || !(await verifyPassword(input.password, account.passwordHash)))
    throw new EmailSecurityError("当前密码或验证器代码不正确")
  const id = randomUUID()
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0")
  await db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(securityMailSettings)
      .where(eq(securityMailSettings.id, "default"))
      .for("share")
    if (!settings?.bindingEnabled)
      throw new EmailSecurityError("邮箱绑定已关闭", 409)
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update")
    if (
      !current ||
      current.status !== "active" ||
      current.mustChangePassword ||
      current.passwordHash !== account.passwordHash ||
      current.tokenVersion !== account.tokenVersion
    )
      throw new EmailSecurityError("账号状态已变化，请重新登录", 409)
    const [factor] = await tx
      .select()
      .from(mfaFactors)
      .where(eq(mfaFactors.userId, actor.id))
      .for("update")
    if (
      factor?.enabled &&
      !(await consumeMfaCodeInTransaction(tx, factor, input.code ?? ""))
    )
      throw new EmailSecurityError(
        "当前密码或验证器代码不正确，已用代码请等待下一组",
      )
    await tx
      .update(challenges)
      .set({ consumedAt: new Date() })
      .where(
        and(eq(challenges.userId, actor.id), isNull(challenges.consumedAt)),
      )
    await tx
      .insert(challenges)
      .values({
        id,
        userId: actor.id,
        emailEncrypted: encryptMfaSecret(input.email),
        codeHash: hashEmailCode(id, code),
        tokenVersion: current.tokenVersion,
        expiresAt: new Date(Date.now() + 300_000),
      })
    await writeAuditLog(
      {
        actor,
        action: "EMAIL_BIND_REQUEST",
        actionLabel: "请求验证安全邮箱",
        entityType: "security_email",
        detail: { email: maskSecurityEmail(input.email) },
      },
      tx,
    )
  })
  try {
    await sendSecurityMail({
      to: input.email,
      kind: "code",
      params: { code, minutes: "5" },
    })
    const [sent] = await db
      .update(challenges)
      .set({ sentAt: new Date() })
      .where(and(eq(challenges.id, id), isNull(challenges.consumedAt)))
      .returning({ id: challenges.id })
    if (!sent) throw new EmailSecurityError("验证请求已失效，请重新发送", 409)
  } catch {
    await db
      .update(challenges)
      .set({ consumedAt: new Date() })
      .where(eq(challenges.id, id))
    throw new EmailSecurityError("邮件发送失败，请稍后重试", 503)
  }
  return {
    challengeId: id,
    maskedEmail: maskSecurityEmail(input.email),
    expiresIn: 300,
    resendAfter: 60,
  }
}

export async function confirmEmailBinding(
  actor: SessionUser,
  id: string,
  code: string,
  ip: string,
) {
  await reserveEmailAttempts(actor.id, ip, "verify")
  const result = await db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(securityMailSettings)
      .where(eq(securityMailSettings.id, "default"))
      .for("share")
    if (!settings?.bindingEnabled)
      throw new EmailSecurityError("邮箱绑定已关闭", 409)
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update")
    const [challenge] = await tx
      .select()
      .from(challenges)
      .where(and(eq(challenges.id, id), eq(challenges.userId, actor.id)))
      .for("update")
    if (
      !user ||
      user.status !== "active" ||
      user.mustChangePassword ||
      !challenge ||
      !challenge.sentAt ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= 5 ||
      challenge.tokenVersion !== user.tokenVersion
    )
      return false
    await tx
      .update(challenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(challenges.id, id))
    if (
      !timingSafeEqual(
        Buffer.from(hashEmailCode(id, code), "hex"),
        Buffer.from(challenge.codeHash, "hex"),
      )
    )
      return false
    const [old] = await tx
      .select()
      .from(securityEmails)
      .where(eq(securityEmails.userId, actor.id))
    if (old)
      await queueSecurityNotice(
        tx,
        actor.id,
        "安全邮箱已换绑；如非本人操作，请立即联系管理员并保护账号。",
        decryptMfaSecret(old.emailEncrypted),
      )
    await tx
      .insert(securityEmails)
      .values({ userId: actor.id, emailEncrypted: challenge.emailEncrypted })
      .onConflictDoUpdate({
        target: securityEmails.userId,
        set: {
          emailEncrypted: challenge.emailEncrypted,
          verifiedAt: new Date(),
        },
      })
    await queueSecurityNotice(
      tx,
      actor.id,
      "安全邮箱绑定成功。邮箱不会替代验证器登录，遗失验证器时请使用离线恢复码或联系管理员。",
    )
    await tx
      .update(challenges)
      .set({ consumedAt: new Date() })
      .where(
        and(eq(challenges.userId, actor.id), isNull(challenges.consumedAt)),
      )
    await tx
      .update(users)
      .set({ tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
      .where(eq(users.id, actor.id))
    await revokeTrustedDevicesInTransaction(tx, actor.id)
    await tx
      .delete(mfaLoginChallenges)
      .where(eq(mfaLoginChallenges.userId, actor.id))
    await writeAuditLog(
      {
        actor,
        action: "EMAIL_BIND",
        actionLabel: old ? "换绑安全邮箱" : "绑定安全邮箱",
        entityType: "security_email",
        detail: {
          email: maskSecurityEmail(decryptMfaSecret(challenge.emailEncrypted)),
        },
      },
      tx,
    )
    return true
  })
  if (!result) throw new EmailSecurityError("验证码不正确、已过期或已使用")
}

export async function runSecurityMailSweep() {
  if (!getSecurityMailConfig().configured) return
  for (let i = 0; i < 5; i++) {
    const row = await db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(securityMailOutbox)
        .where(
          and(
            isNull(securityMailOutbox.sentAt),
            lt(securityMailOutbox.attempts, 5),
            lt(securityMailOutbox.nextAttemptAt, new Date()),
          ),
        )
        .limit(1)
        .for("update", { skipLocked: true })
      if (!item) return null
      await tx
        .update(securityMailOutbox)
        .set({
          attempts: item.attempts + 1,
          nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** item.attempts),
        })
        .where(eq(securityMailOutbox.id, item.id))
      return item
    })
    if (!row) break
    try {
      await sendSecurityMail(
        JSON.parse(decryptMfaSecret(row.payloadEncrypted)) as SecurityMail,
      )
      await db
        .update(securityMailOutbox)
        .set({ sentAt: new Date() })
        .where(eq(securityMailOutbox.id, row.id))
    } catch {
      console.error(
        "[security-mail] notification delivery failed; queued for bounded retry",
      )
    }
  }
}

const key = Symbol.for("custodysim.security-mail")
export function startSecurityMailScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [key]?: ReturnType<typeof setInterval>
  }
  if (runtime[key]) return
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await runSecurityMailSweep()
      const yesterday = new Date(Date.now() - 86400_000)
      await db
        .delete(mfaLoginChallenges)
        .where(lt(mfaLoginChallenges.expiresAt, yesterday))
      await db.delete(challenges).where(lt(challenges.expiresAt, yesterday))
      await db
        .delete(securityMailLimits)
        .where(lt(securityMailLimits.lastSentAt, yesterday))
      await db
        .delete(securityMailOutbox)
        .where(
          lt(
            securityMailOutbox.createdAt,
            new Date(Date.now() - 14 * 86400_000),
          ),
        )
    } catch {
      console.error("[security-mail] background maintenance unavailable")
    } finally {
      running = false
    }
  }
  runtime[key] = setInterval(() => void run(), 60_000)
  runtime[key].unref?.()
}
