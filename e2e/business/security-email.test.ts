import { createHmac, randomUUID } from "node:crypto"
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  test,
  expect,
  vi,
} from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import {
  hashPassword,
  signMfaChallenge,
  signToken,
  verifyMfaChallenge,
} from "@/lib/auth"
import {
  decryptMfaSecret,
  encryptMfaSecret,
  fromBase32,
  hashRecoveryCode,
} from "@/lib/mfa"
import { consumeMfaLogin } from "@/lib/mfa-login-server"
import {
  beginEmailBinding,
  confirmEmailBinding,
  runSecurityMailSweep,
} from "@/lib/security-mail-server"
import { sendSecurityMail } from "@/lib/security-mail"
import {
  GET as mailStatus,
  PUT as mailPolicy,
} from "@/app/api/admin/security-mail/route"
import type { SessionUser } from "@/lib/session"

vi.mock("@/lib/security-mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security-mail")>()),
  sendSecurityMail: vi.fn(),
}))
// 只替身 Next 的 cookie 读取；JWT 校验、角色判断与路由逻辑保持真实。
const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
}))
const ids: string[] = []
let actor: SessionUser
let passwordHash: string
const password = "EmailTest12345"
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
function currentCode() {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac("sha1", fromBase32(secret)).update(buffer).digest()
  const offset = digest[19] & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0")
}
async function bind() {
  const challenge = await beginEmailBinding(
    actor,
    { email: "member@example.com", password },
    actor.id,
  )
  const code = vi.mocked(sendSecurityMail).mock.calls.at(-1)![0].params.code
  return { ...challenge, code }
}
async function factor() {
  const [value] = await db
    .insert(s.mfaFactors)
    .values({
      userId: actor.id,
      enabled: true,
      secretEncrypted: encryptMfaSecret(secret),
      // 该列不再有数据库默认值，未使用过时显式写入 -1。
      lastUsedStep: -1,
    })
    .returning()
  return value
}
async function loginChallenge() {
  const value = { challengeId: randomUUID(), userId: actor.id, tokenVersion: 0 }
  await db
    .insert(s.mfaLoginChallenges)
    .values({
      id: value.challengeId,
      userId: actor.id,
      tokenVersion: 0,
      expiresAt: new Date(Date.now() + 300000),
    })
  return value
}
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  passwordHash = await hashPassword(password)
})
beforeEach(async () => {
  const id = randomUUID()
  ids.push(id)
  actor = {
    id,
    name: "邮箱验证测试",
    username: `e2e_${id}`,
    role: "ADMIN",
    organizationId: null,
    mustChangePassword: false,
  }
  await db.insert(s.users).values({ ...actor, passwordHash })
  await db
    .insert(s.securityMailSettings)
    .values({ id: "default", bindingEnabled: true })
    .onConflictDoUpdate({
      target: s.securityMailSettings.id,
      set: { bindingEnabled: true },
    })
  vi.stubEnv("TENCENT_SES_SECRET_ID", "test-id")
  vi.stubEnv("TENCENT_SES_SECRET_KEY", "test-secret")
  vi.stubEnv("TENCENT_SES_REGION", "ap-guangzhou")
  vi.stubEnv("TENCENT_SES_FROM", "sender@example.com")
  vi.stubEnv("TENCENT_SES_CODE_TEMPLATE_ID", "1")
  vi.stubEnv("TENCENT_SES_NOTICE_TEMPLATE_ID", "2")
  vi.mocked(sendSecurityMail).mockReset().mockResolvedValue(undefined)
  cookie.token = await signToken({ userId: id, role: "ADMIN", tokenVersion: 0 })
  await db.delete(s.securityMailLimits)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
afterAll(async () => {
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
  await db.delete(s.users).where(inArray(s.users.id, ids))
  await db.delete(s.securityMailSettings)
  await db.delete(s.securityMailLimits)
  await db.$client.end()
})

test("邮箱验证码绑定、原子消费、撤销会话与设备；通知进入加密队列", async () => {
  await db
    .insert(s.securityEmails)
    .values({
      userId: actor.id,
      emailEncrypted: encryptMfaSecret("old@example.com"),
    })
  await db
    .insert(s.mfaTrustedDevices)
    .values({
      userId: actor.id,
      tokenHash: "a".repeat(64),
      label: "test",
      expiresAt: new Date(Date.now() + 86400000),
    })
  await loginChallenge()
  const row = await bind()
  const [stored] = await db
    .select()
    .from(s.emailVerificationChallenges)
    .where(eq(s.emailVerificationChallenges.id, row.challengeId))
  expect(stored.codeHash).toHaveLength(64)
  expect(stored.emailEncrypted).not.toContain("member@example.com")
  expect(row.maskedEmail).toBe("m***@example.com")
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      confirmEmailBinding(actor, row.challengeId, row.code, actor.id),
    ),
  )
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  const [email] = await db
    .select()
    .from(s.securityEmails)
    .where(eq(s.securityEmails.userId, actor.id))
  expect(decryptMfaSecret(email.emailEncrypted)).toBe("member@example.com")
  expect(
    (await db.select().from(s.users).where(eq(s.users.id, actor.id)))[0]
      .tokenVersion,
  ).toBe(1)
  expect(
    (
      await db
        .select()
        .from(s.mfaTrustedDevices)
        .where(eq(s.mfaTrustedDevices.userId, actor.id))
    )[0].revokedAt,
  ).not.toBeNull()
  expect(
    await db
      .select()
      .from(s.mfaLoginChallenges)
      .where(eq(s.mfaLoginChallenges.userId, actor.id)),
  ).toHaveLength(0)
  const mails = await db
    .select()
    .from(s.securityMailOutbox)
    .where(eq(s.securityMailOutbox.userId, actor.id))
  expect(mails).toHaveLength(2)
  expect(
    mails
      .map((m) => JSON.parse(decryptMfaSecret(m.payloadEncrypted)).to)
      .sort(),
  ).toEqual(["member@example.com", "old@example.com"])
})

test("错误码最多五次，正确码也不能解锁耗尽的挑战", async () => {
  const row = await bind()
  const wrong = row.code === "000000" ? "111111" : "000000"
  for (let i = 0; i < 5; i++)
    await expect(
      confirmEmailBinding(actor, row.challengeId, wrong, actor.id),
    ).rejects.toThrow()
  await expect(
    confirmEmailBinding(actor, row.challengeId, row.code, actor.id),
  ).rejects.toThrow()
  expect(
    await db
      .select()
      .from(s.securityEmails)
      .where(eq(s.securityEmails.userId, actor.id)),
  ).toHaveLength(0)
})

test("过期、跨账号和改密后的验证码不生效", async () => {
  const row = await bind()
  await expect(
    confirmEmailBinding(
      { ...actor, id: randomUUID() },
      row.challengeId,
      row.code,
      "other-ip",
    ),
  ).rejects.toThrow()
  await db
    .update(s.emailVerificationChallenges)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(s.emailVerificationChallenges.id, row.challengeId))
  await expect(
    confirmEmailBinding(actor, row.challengeId, row.code, actor.id),
  ).rejects.toThrow()
  await db
    .update(s.emailVerificationChallenges)
    .set({ expiresAt: new Date(Date.now() + 300000) })
    .where(eq(s.emailVerificationChallenges.id, row.challengeId))
  await db
    .update(s.users)
    .set({ tokenVersion: 1 })
    .where(eq(s.users.id, actor.id))
  await expect(
    confirmEmailBinding(actor, row.challengeId, row.code, actor.id),
  ).rejects.toThrow()
})

test("重发限流且旧码失效，发送失败不留下可用验证码", async () => {
  const first = await bind()
  await expect(bind()).rejects.toThrow("频繁")
  await db
    .update(s.securityMailLimits)
    .set({ lastSentAt: new Date(Date.now() - 61000) })
  const second = await bind()
  await expect(
    confirmEmailBinding(actor, first.challengeId, first.code, actor.id),
  ).rejects.toThrow()
  await db
    .update(s.securityMailLimits)
    .set({ lastSentAt: new Date(Date.now() - 61000) })
  vi.mocked(sendSecurityMail).mockRejectedValue(new Error("provider failure"))
  await expect(bind()).rejects.toThrow("发送失败")
  await expect(
    confirmEmailBinding(actor, second.challengeId, second.code, actor.id),
  ).rejects.toThrow()
  const rows = await db
    .select()
    .from(s.emailVerificationChallenges)
    .where(eq(s.emailVerificationChallenges.userId, actor.id))
  expect(rows.every((row) => row.consumedAt !== null)).toBe(true)
})

test("发送前必须验证当前密码和已有 MFA，同一步 TOTP 不能重复使用", async () => {
  await factor()
  await expect(
    beginEmailBinding(
      actor,
      { email: "member@example.com", password: "bad" },
      actor.id,
    ),
  ).rejects.toThrow()
  await db.delete(s.securityMailLimits)
  await expect(bind()).rejects.toThrow("验证器")
  expect(sendSecurityMail).not.toHaveBeenCalled()
  await db.delete(s.securityMailLimits)
  await beginEmailBinding(
    actor,
    { email: "member@example.com", password, code: currentCode() },
    actor.id,
  )
  await db.delete(s.securityMailLimits)
  await expect(
    beginEmailBinding(
      actor,
      { email: "member@example.com", password, code: currentCode() },
      actor.id,
    ),
  ).rejects.toThrow("验证器")
})

test("数据库发送限额在并发请求下也只允许一次", async () => {
  const results = await Promise.allSettled([1, 2, 3].map(() => bind()))
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  expect(sendSecurityMail).toHaveBeenCalledTimes(1)
})

test("一次性登录挑战和 TOTP 防重放跨并发请求生效", async () => {
  await factor()
  const challenge = await loginChallenge()
  const results = await Promise.all(
    [1, 2].map(() => consumeMfaLogin(challenge, currentCode(), true, actor.id)),
  )
  expect(results.filter(Boolean)).toHaveLength(1)
  const another = await loginChallenge()
  expect(
    await consumeMfaLogin(another, currentCode(), true, actor.id),
  ).toBeNull()
  expect(
    await db
      .select()
      .from(s.mfaTrustedDevices)
      .where(eq(s.mfaTrustedDevices.userId, actor.id)),
  ).toHaveLength(1)
  const jwt = await signMfaChallenge(actor.id, 0, challenge.challengeId)
  expect(await verifyMfaChallenge(jwt)).toEqual(challenge)
})

test("恢复码不能重用已消费挑战，过期、撤销、耗尽挑战均拒绝", async () => {
  const item = await factor()
  await db
    .insert(s.mfaRecoveryCodes)
    .values(
      ["ABCD-EFGH-IJKL", "MNOP-QRST-UVWX"].map((code) => ({
        factorId: item.id,
        codeHash: hashRecoveryCode(code),
      })),
    )
  const challenge = await loginChallenge()
  expect(
    await consumeMfaLogin(challenge, "ABCD-EFGH-IJKL", false, actor.id),
  ).not.toBeNull()
  expect(
    await consumeMfaLogin(challenge, "MNOP-QRST-UVWX", false, actor.id),
  ).toBeNull()
  const expired = await loginChallenge()
  await db
    .update(s.mfaLoginChallenges)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(s.mfaLoginChallenges.id, expired.challengeId))
  expect(
    await consumeMfaLogin(expired, "MNOP-QRST-UVWX", false, actor.id),
  ).toBeNull()
  const blocked = await loginChallenge()
  for (let i = 0; i < 5; i++)
    expect(
      await consumeMfaLogin(blocked, "invalid", false, actor.id),
    ).toBeNull()
  expect(
    await consumeMfaLogin(blocked, "MNOP-QRST-UVWX", false, actor.id),
  ).toBeNull()
  const revoked = await loginChallenge()
  await db
    .update(s.users)
    .set({ tokenVersion: 1 })
    .where(eq(s.users.id, actor.id))
  expect(
    await consumeMfaLogin(revoked, "MNOP-QRST-UVWX", false, actor.id),
  ).toBeNull()
})

test("管理接口不暴露凭据，仅管理员可修改；关闭策略阻止在途确认", async () => {
  const row = await bind()
  const response = await mailStatus()
  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).not.toContain("test-secret")
  expect(text).not.toContain("test-id")
  cookie.token = ""
  expect((await mailStatus()).status).toBe(403)
  expect(
    (
      await mailPolicy(
        new Request("http://local", {
          method: "PUT",
          body: JSON.stringify({ bindingEnabled: false }),
        }),
      )
    ).status,
  ).toBe(403)
  cookie.token = await signToken({
    userId: actor.id,
    role: "ADMIN",
    tokenVersion: 0,
  })
  expect(
    (
      await mailPolicy(
        new Request("http://local", {
          method: "PUT",
          body: JSON.stringify({ bindingEnabled: false }),
        }),
      )
    ).status,
  ).toBe(200)
  await expect(
    confirmEmailBinding(actor, row.challengeId, row.code, actor.id),
  ).rejects.toThrow("关闭")
})

test("通知失败保留有限重试队列，成功标记已提交", async () => {
  const row = await bind()
  await confirmEmailBinding(actor, row.challengeId, row.code, actor.id)
  vi.mocked(sendSecurityMail).mockRejectedValue(new Error("unavailable"))
  vi.spyOn(console, "error").mockImplementation(() => {})
  await runSecurityMailSweep()
  const [notice] = await db
    .select()
    .from(s.securityMailOutbox)
    .where(eq(s.securityMailOutbox.userId, actor.id))
  expect(notice.attempts).toBe(1)
  expect(notice.sentAt).toBeNull()
  await db
    .update(s.securityMailOutbox)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(s.securityMailOutbox.id, notice.id))
  vi.mocked(sendSecurityMail).mockResolvedValue(undefined)
  await runSecurityMailSweep()
  expect(
    (
      await db
        .select()
        .from(s.securityMailOutbox)
        .where(eq(s.securityMailOutbox.id, notice.id))
    )[0].sentAt,
  ).not.toBeNull()
})
