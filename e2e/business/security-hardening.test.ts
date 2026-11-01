import { createHash, randomUUID } from "node:crypto"
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { loginLogs, loginRateLimits, users } from "@/lib/db/schema"
import { hashPassword } from "@/lib/auth"
import { POST as login } from "@/app/api/auth/login/route"
import {
  getLoginRateLimitKeys,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"
import { consumeRegistrationAttempt } from "@/lib/registration-server"
import {
  AppReleaseConflictError,
  withAppReleaseLock,
} from "@/lib/app-release-server"

const id = randomUUID()
const username = `hardening_${id.slice(0, 16)}`
const attacker = `198.19.${parseInt(id.slice(0, 2), 16)}.1`
const victim = `198.19.${parseInt(id.slice(0, 2), 16)}.2`
const deviceA = randomUUID(),
  deviceB = randomUUID()
const keys = [
  ...getLoginRateLimitKeys(username, attacker),
  ...getLoginRateLimitKeys(username, victim),
  ...[deviceA, deviceB].map((device) =>
    createHash("sha256").update(`registration:device:${device}`).digest("hex"),
  ),
]
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  await db
    .insert(users)
    .values({
      id,
      username,
      name: "hardening test",
      passwordHash: await hashPassword("Password123!"),
      role: "ADMIN",
      mustChangePassword: false,
    })
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  await db.delete(loginRateLimits).where(inArray(loginRateLimits.key, keys))
  await db.delete(loginLogs).where(eq(loginLogs.username, username))
  await db.delete(users).where(eq(users.id, id))
  await db.$client.end()
})

test("其他来源的账号失败锁定不阻止正确密码，来源限流仍生效", async () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("TRUST_PROXY", "true")
  for (let i = 0; i < 5; i++) await recordLoginFailure(username, attacker)
  expect(await getLoginRetryAfterSeconds(username, victim)).toBeGreaterThan(0)
  const request = (password: string, ip: string) =>
    new NextRequest("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ username, password }),
    })
  expect((await login(request("wrong", victim))).status).toBe(429)
  const valid = await login(request("Password123!", victim))
  expect(valid.status).toBe(200)
  expect(valid.headers.get("set-cookie")).toContain("HttpOnly")
  expect(await getLoginRetryAfterSeconds(username, victim)).toBe(0)
  expect((await login(request("Password123!", attacker))).status).toBe(429)
})

test("无 IP 的注册额度隔离到浏览器，缺少任何标识不创建全站桶", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      consumeRegistrationAttempt(null, new Date(), deviceA),
    ),
  )
  expect(results.filter((value) => value === 0)).toHaveLength(5)
  expect(results.filter((value) => value > 0)).toHaveLength(5)
  expect(await consumeRegistrationAttempt(null, new Date(), deviceB)).toBe(0)
  expect(await consumeRegistrationAttempt(null)).toBe(0)
})

test("跨连接发布锁拒绝重叠发布，成功或失败后均释放", async () => {
  let unlock!: () => void, entered!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    unlock = resolve
  })
  const first = withAppReleaseLock(async () => {
    entered()
    await gate
    return "first"
  })
  await ready
  try {
    await expect(
      withAppReleaseLock(async () => "second"),
    ).rejects.toBeInstanceOf(AppReleaseConflictError)
  } finally {
    unlock()
    await first
  }
  await expect(
    withAppReleaseLock(async () => {
      throw new Error("publish failure")
    }),
  ).rejects.toThrow("publish failure")
  await expect(withAppReleaseLock(async () => "next")).resolves.toBe("next")
})
