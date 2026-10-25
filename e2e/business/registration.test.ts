import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import pg from "pg"
import { startPushWorker } from "../../scripts/push-worker.mjs"
import { registerPushDevice } from "@/lib/push-server"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import {
  GET as signupConfig,
  POST as signup,
} from "@/app/api/auth/register/route"
import {
  registrationBrowserCookie,
  registrationRisk,
} from "@/lib/registration-browser"
import {
  GET as manageRegistration,
  PATCH as configure,
  POST as ban,
  DELETE as unblock,
} from "@/app/api/admin/registration/route"
import {
  createRegistration,
  getRegistrationSettings,
  consumeRegistrationAttempt,
  blockRegistrationEmail,
  probationScore,
  runRegistrationSweep,
  assertRegistrationRisk,
} from "@/lib/registration-server"
import {
  RegistrationSchema,
  REGISTRATION_GRACE_MS,
  registrationEmailHash,
} from "@/lib/registration-policy"
import { ensureTodayCheckinTasks } from "@/lib/checkin"
import { ensureUserTasks } from "@/lib/task-engine"
import { getSessionUser } from "@/lib/session"
import { signToken } from "@/lib/auth"
import {
  issueRefreshToken,
  rotateRefreshToken,
} from "@/lib/refresh-token-server"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"

const auth = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () =>
    new Headers(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
}))
const ids: string[] = [],
  hashes: string[] = []
const riskHashes: string[] = []
const testIp = `198.18.${parseInt(randomUUID().slice(0, 2), 16)}.${parseInt(randomUUID().slice(0, 2), 16)}`
let originalSettings: typeof s.registrationSettings.$inferSelect
let adminId: string
function input() {
  const tag = randomUUID().replaceAll("-", "")
  const value = RegistrationSchema.parse({
    username: `reg_${tag}`,
    name: "注册测试",
    email: `${tag}@example.com`,
    password: "Password123",
    confirmPassword: "Password123",
    acceptTrial: true,
  })
  hashes.push(registrationEmailHash(value.email))
  return value
}
async function register(now = new Date()) {
  const value = input()
  const account = await createRegistration(value, now)
  ids.push(account.id)
  return { ...account, email: value.email }
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-real-ip": testIp,
      ...headers,
    },
  })
}
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  originalSettings = await getRegistrationSettings()
  await db
    .update(s.registrationSettings)
    .set({ enabled: true })
    .where(eq(s.registrationSettings.id, 1))
  adminId = randomUUID()
  ids.push(adminId)
  await db.insert(s.users).values({
    id: adminId,
    username: `reg_admin_${adminId}`,
    name: "管理员",
    passwordHash: "unused",
    role: "ADMIN",
    mustChangePassword: false,
  })
})
afterAll(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  if (riskHashes.length)
    await db
      .delete(s.registrationRiskBlocks)
      .where(inArray(s.registrationRiskBlocks.valueHash, riskHashes))
  await db
    .update(s.registrationSettings)
    .set({
      enabled: originalSettings.enabled,
      organizationId: originalSettings.organizationId,
    })
    .where(eq(s.registrationSettings.id, 1))
  await db
    .delete(s.checkinDailyScores)
    .where(inArray(s.checkinDailyScores.supervisedId, ids))
  await db
    .delete(s.checkinTasks)
    .where(inArray(s.checkinTasks.supervisedId, ids))
  await db.delete(s.reportTasks).where(inArray(s.reportTasks.supervisedId, ids))
  await db.delete(s.scoreEvents).where(inArray(s.scoreEvents.supervisedId, ids))
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.entityId, ids))
  await db.delete(s.users).where(inArray(s.users.id, ids))
  await db
    .delete(s.registrationEmailBlocks)
    .where(inArray(s.registrationEmailBlocks.emailHash, hashes))
})
test("Web 注册固定权限、密码确认与同源边界，邮箱只存摘要", async () => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "business-site")
  vi.stubEnv("TURNSTILE_SECRET_KEY", "business-secret")
  const config = await signupConfig(
    new NextRequest("http://localhost/api/auth/register"),
  )
  const cookie = config.headers.get("set-cookie")!.split(";")[0]
  const cdata = (await config.json()).data.captcha.cData
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({
        success: true,
        hostname: "localhost",
        action: "register",
        cdata,
        challenge_ts: new Date().toISOString(),
      }),
    )
  vi.stubGlobal("fetch", fetcher)
  const value = input()
  expect(
    (await signup(request(value, { origin: "https://untrusted.example" })))
      .status,
  ).toBe(403)
  expect(
    (await signup(request(value, { "x-custodysim-client": "android-app/2" })))
      .status,
  ).toBe(403)
  expect((await signup(request({ ...value, role: "ADMIN" }))).status).toBe(400)
  expect((await signup(request(value))).status).toBe(403)
  const response = await signup(
    request({ ...value, captchaToken: "test-token" }, { cookie }),
  )
  expect(response.status).toBe(201)
  const created = (await response.json()).data
  ids.push(created.id)
  expect(response.headers.get("set-cookie")).toContain("HttpOnly")
  const [user] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, created.id))
  expect(user!.role).toBe("SUPERVISED")
  auth.token = await signToken({
    userId: created.id,
    role: "SUPERVISED",
    tokenVersion: 0,
  })
  expect(
    (
      await manageRegistration(
        new Request("http://localhost/api/admin/registration"),
      )
    ).status,
  ).toBe(403)
  expect(user!.mustChangePassword).toBe(false)
  const [profile] = await db
    .select()
    .from(s.persons)
    .where(eq(s.persons.userId, created.id))
  expect(profile!.custodyStatus).toBe("IN_CUSTODY")
  const [entry] = await db
    .select()
    .from(s.registrations)
    .where(eq(s.registrations.userId, created.id))
  expect(entry!.emailHash).toBe(registrationEmailHash(value.email))
  expect(JSON.stringify(entry)).not.toContain(value.email)
  expect(
    await db
      .select()
      .from(s.securityEmails)
      .where(eq(s.securityEmails.userId, created.id)),
  ).toHaveLength(0)
  vi.unstubAllGlobals()
})
test("同邮箱并发注册仅能成功一次，关闭注册与管理员边界有效", async () => {
  const value = input()
  const outcomes = await Promise.allSettled([
    createRegistration(value),
    createRegistration({ ...value, username: value.username + "b" }),
  ])
  const successful = outcomes.filter(
    (outcome) => outcome.status === "fulfilled",
  )
  for (const item of successful)
    if (item.status === "fulfilled") ids.push(item.value.id)
  expect(successful).toHaveLength(1)
  auth.token = ""
  expect(
    (await configure(request({ enabled: false, organizationId: null }))).status,
  ).toBe(403)
  auth.token = await signToken({
    userId: adminId,
    role: "ADMIN",
    tokenVersion: 0,
  })
  const settings = await getRegistrationSettings()
  expect(
    (
      await configure(
        request({ enabled: false, organizationId: settings.organizationId }),
      )
    ).status,
  ).toBe(200)
  await expect(createRegistration(input())).rejects.toThrow("当前暂未开放注册")
  await db
    .update(s.registrationSettings)
    .set({ enabled: true })
    .where(eq(s.registrationSettings.id, 1))
})
test("浏览器并发额度、封禁持久化与共享网络临时限制", async () => {
  const ip = `198.21.${parseInt(randomUUID().slice(0, 2), 16)}.${parseInt(randomUUID().slice(0, 2), 16)}`
  const risk = registrationRisk(registrationBrowserCookie(), ip)!
  riskHashes.push(risk.deviceHash, risk.networkHash!)
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, async () => {
      const account = await createRegistration(input(), new Date(), risk)
      ids.push(account.id)
      return account
    }),
  )
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(2)
  const blocked = results.find(
    (item) => item.status === "rejected",
  ) as PromiseRejectedResult
  expect(blocked.reason.status).toBe(429)
  const first = results.find(
    (item) => item.status === "fulfilled",
  ) as PromiseFulfilledResult<{ id: string }>
  const [entry] = await db
    .select()
    .from(s.registrations)
    .where(eq(s.registrations.userId, first.value.id))
  await blockRegistrationEmail(entry.emailHash, "违规测试")
  await expect(assertRegistrationRisk(risk)).rejects.toMatchObject({
    status: 403,
  })
  const newRisk = () => {
    const next = registrationRisk(registrationBrowserCookie(), ip)!
    riskHashes.push(next.deviceHash)
    return next
  }
  await expect(assertRegistrationRisk(newRisk())).resolves.toBeUndefined()
  for (let i = 0; i < 2; i++) {
    const value = input()
    const account = await createRegistration(value, new Date(), newRisk())
    ids.push(account.id)
    await blockRegistrationEmail(registrationEmailHash(value.email), "违规测试")
  }
  const fresh = newRisk()
  await expect(assertRegistrationRisk(fresh)).rejects.toMatchObject({
    status: 403,
  })
  await expect(
    assertRegistrationRisk(fresh, new Date(Date.now() + 86400_000 + 1000)),
  ).resolves.toBeUndefined()
  await db.delete(s.users).where(eq(s.users.id, first.value.id))
  await expect(assertRegistrationRisk(risk)).rejects.toMatchObject({
    status: 403,
  })
  auth.token = ""
  const [deviceBlock] = await db
    .select()
    .from(s.registrationRiskBlocks)
    .where(eq(s.registrationRiskBlocks.valueHash, risk.deviceHash))
  expect((await unblock(request({ riskBlockId: deviceBlock.id }))).status).toBe(
    403,
  )
  auth.token = await signToken({
    userId: adminId,
    role: "ADMIN",
    tokenVersion: 0,
  })
  expect((await unblock(request({ riskBlockId: deviceBlock.id }))).status).toBe(
    200,
  )
})

test("注册限流按网络原子计数，成功请求也占额度", async () => {
  const ip = `198.20.${parseInt(randomUUID().slice(0, 2), 16)}.${parseInt(randomUUID().slice(0, 2), 16)}`
  const results = await Promise.all(
    Array.from({ length: 10 }, () => consumeRegistrationAttempt(ip)),
  )
  expect(results.filter((value) => value === 0)).toHaveLength(5)
  expect(results.filter((value) => value > 0)).toHaveLength(5)
})

test("考察前一天提醒按设备去重，在线投递包含正确的到期时间", async () => {
  const now = new Date()
  const user = await register()
  const end = new Date(now.getTime() + 12 * 60 * 60_000)
  await db
    .update(s.registrations)
    .set({ trialStart: new Date(end.getTime() - 7 * 86400_000), trialEnd: end })
    .where(eq(s.registrations.userId, user.id))
  const device = (await registerPushDevice(user.id, {
    installationId: randomUUID(),
    secret: "fe".repeat(32),
    enabled: true,
  }))!
  await runRegistrationSweep(now)
  await runRegistrationSweep(now)
  const queued = await db
    .select()
    .from(s.pushDeliveries)
    .where(eq(s.pushDeliveries.userId, user.id))
  expect(queued).toHaveLength(1)
  expect(queued[0]!.kind).toBe("PROBATION")
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const payloads: Record<string, string>[] = []
  const worker = startPushWorker(
    pool,
    {
      sockets: {
        adapter: {
          rooms: new Map([
            [`device:${device.id}:${device.bindingId}`, new Set(["app"])],
          ]),
        },
      },
      to: () => ({
        timeout: () => ({
          emitWithAck: async (
            _event: string,
            payload: Record<string, string>,
          ) => {
            payloads.push(payload)
            return [{ ok: true }]
          },
        }),
      }),
    },
    { intervalMs: 30 },
  )
  try {
    worker.wake()
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(s.pushDeliveries)
              .where(eq(s.pushDeliveries.id, queued[0]!.id))
          )[0]?.state,
        { timeout: 5000 },
      )
      .toBe("DIRECT")
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.expiresAt).toBe(end.toISOString())
    expect(JSON.stringify(payloads)).not.toContain(user.email)
  } finally {
    await worker.stop()
    await pool.end()
  }
})
test("不追补注册前打卡和规则任务；考察积分包括晚入账日结但排除期外流水", async () => {
  const now = new Date()
  const user = await register(now)
  await ensureTodayCheckinTasks(user.id, now)
  await ensureUserTasks(user.id, now)
  const tasks = await db
    .select()
    .from(s.checkinTasks)
    .where(eq(s.checkinTasks.supervisedId, user.id))
  expect(tasks.every((task) => task.scheduleAt >= now)).toBe(true)
  const old = await register(new Date(now.getTime() - 9 * 86400_000))
  const [entry] = await db
    .select()
    .from(s.registrations)
    .where(eq(s.registrations.userId, old.id))
  const [day] = await db
    .insert(s.checkinDailyScores)
    .values({
      supervisedId: old.id,
      dayKey: getShanghaiDateKey(
        new Date(entry!.trialEnd.getTime() - 86400_000),
      ),
      scheduledCount: 1,
      completedCount: 1,
      missingCount: 0,
      points: 1,
    })
    .returning()
  await db.insert(s.scoreEvents).values([
    {
      supervisedId: old.id,
      weekKey: "2026-10-12",
      points: 1,
      source: "CHECKIN_DAILY",
      sourceId: day!.id,
      reason: "延后日结",
      createdAt: new Date(entry!.trialEnd.getTime() + 60000),
    },
    {
      supervisedId: old.id,
      weekKey: "2026-10-12",
      points: 2,
      source: "MANUAL",
      reason: "期内",
      createdAt: new Date(entry!.trialStart.getTime() + 60000),
    },
    {
      supervisedId: old.id,
      weekKey: "2026-10-12",
      points: -10,
      source: "MANUAL",
      reason: "期外",
      createdAt: new Date(entry!.trialStart.getTime() - 60000),
    },
  ])
  expect(await probationScore(old.id, entry!.trialStart, entry!.trialEnd)).toBe(
    3,
  )
})
test("正分通过、零分与负分停用，重复扫描幂等并撤销 Web/App 会话", async () => {
  const now = new Date()
  const positive = await register(new Date(now.getTime() - 9 * 86400_000))
  const zero = await register(new Date(now.getTime() - 9 * 86400_000))
  const negative = await register(new Date(now.getTime() - 9 * 86400_000))
  for (const [account, points] of [
    [positive, 1],
    [negative, -1],
  ] as const)
    await db.insert(s.scoreEvents).values({
      supervisedId: account.id,
      weekKey: "2026-10-12",
      points,
      reason: "考察测试",
      source: "MANUAL",
      createdAt: new Date(account.trialStart.getTime() + 60000),
    })
  auth.token = await signToken({
    userId: zero.id,
    role: "SUPERVISED",
    tokenVersion: 0,
  })
  expect(await getSessionUser()).not.toBeNull()
  const refresh = await issueRefreshToken({ userId: zero.id, tokenVersion: 0 })
  await runRegistrationSweep(now)
  const states = await db
    .select()
    .from(s.registrations)
    .where(inArray(s.registrations.userId, [positive.id, zero.id, negative.id]))
  expect(states.find((entry) => entry.userId === positive.id)!.state).toBe(
    "PASSED",
  )
  expect(states.find((entry) => entry.userId === zero.id)!.state).toBe("FAILED")
  expect(states.find((entry) => entry.userId === negative.id)!.state).toBe(
    "FAILED",
  )
  expect(await getSessionUser()).toBeNull()
  expect(await rotateRefreshToken(refresh, {})).toBeNull()
  const [before] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, zero.id))
  await runRegistrationSweep(now)
  const [after] = await db.select().from(s.users).where(eq(s.users.id, zero.id))
  expect(after!.tokenVersion).toBe(before!.tokenVersion)
  expect(
    await db
      .select()
      .from(s.registrationEmailBlocks)
      .where(
        eq(
          s.registrationEmailBlocks.emailHash,
          registrationEmailHash(zero.email),
        ),
      ),
  ).toHaveLength(1)
})
test("截止后预留结算宽限，邮箱黑名单在删号后仍保留", async () => {
  const account = await register()
  const end = new Date(Date.now() - 20 * 60_000)
  await db
    .update(s.registrations)
    .set({ trialStart: new Date(end.getTime() - 7 * 86400_000), trialEnd: end })
    .where(eq(s.registrations.userId, account.id))
  await runRegistrationSweep(
    new Date(end.getTime() + REGISTRATION_GRACE_MS - 1),
  )
  expect(
    (
      await db
        .select()
        .from(s.registrations)
        .where(eq(s.registrations.userId, account.id))
    )[0]!.state,
  ).toBe("PENDING")
  await runRegistrationSweep(new Date(end.getTime() + REGISTRATION_GRACE_MS))
  expect(
    (
      await db
        .select()
        .from(s.registrations)
        .where(eq(s.registrations.userId, account.id))
    )[0]!.state,
  ).toBe("FAILED")
  auth.token = ""
  expect(
    (await ban(request({ userId: account.id, reason: "测试拉黑" }))).status,
  ).toBe(403)
  await blockRegistrationEmail(registrationEmailHash(account.email), "测试拉黑")
  await db.delete(s.users).where(eq(s.users.id, account.id))
  expect(
    await db
      .select()
      .from(s.registrationEmailBlocks)
      .where(
        eq(
          s.registrationEmailBlocks.emailHash,
          registrationEmailHash(account.email),
        ),
      ),
  ).toHaveLength(1)
  await expect(
    createRegistration({ ...input(), email: account.email.toUpperCase() }),
  ).rejects.toThrow("用户名或邮箱不可用")
  auth.token = await signToken({
    userId: adminId,
    role: "ADMIN",
    tokenVersion: 0,
  })
  expect(
    (await unblock(request({ email: account.email.toUpperCase() }))).status,
  ).toBe(200)
  const recreated = await createRegistration({
    ...input(),
    email: account.email,
  })
  ids.push(recreated.id)
})
