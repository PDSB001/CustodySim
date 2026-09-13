import { createHmac, randomUUID } from "node:crypto"
import { test, expect } from "@playwright/test"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as s from "../lib/db/schema"
import { hashPassword } from "../lib/auth"
import { fromBase32 } from "../lib/mfa"

let db: typeof import("../lib/db").db
test.beforeAll(async () => {
  const url = process.env.E2E_SCORING_DATABASE_URL
  if (!url || new URL(url).pathname !== "/custodysim_e2e")
    throw new Error("Requires isolated browser config")
  process.env.DATABASE_URL = url
  db = drizzle({ client: new Pool({ connectionString: url }), schema: s })
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
})
test.afterAll(async () => {
  await db.$client.end()
})
function totp(secret: string) {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac("sha1", fromBase32(secret)).update(bytes).digest()
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0")
}

test("真实 MFA 启用、恢复码登录与挑战重放拦截；邮件配置页不泄露凭据", async ({
  page,
  playwright,
  baseURL,
}) => {
  const id = randomUUID()
  const password = "SecurityBrowser12345"
  const other = await playwright.request.newContext({ baseURL })
  try {
    await db
      .insert(s.users)
      .values({
        id,
        username: `e2e_${id}`,
        name: "安全功能验证",
        role: "ADMIN",
        mustChangePassword: false,
        passwordHash: await hashPassword(password),
      })
    await page.goto("/login")
    await page.getByLabel("账号").fill(`e2e_${id}`)
    await page.getByLabel("密码").fill(password)
    await page.getByRole("button", { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(`${baseURL}/`)
    await page.goto("/security-mail")
    await expect(
      page.getByRole("heading", { name: "安全邮件", exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/配置未完成/)).toBeVisible()
    await page.getByRole("switch", { name: "允许绑定安全邮箱" }).check()
    await expect(page.getByRole("button", { name: "保存策略" })).toBeDisabled()
    expect((await other.get("/api/admin/security-mail")).status()).toBe(403)
    await page.goto("/security")
    await expect(page.getByText("管理员尚未开启邮箱绑定服务。")).toBeVisible()
    const setup = await page.request.post("/api/auth/mfa/setup", {
      data: { password },
    })
    expect(setup.status()).toBe(200)
    const secret = (await setup.json()).data.secret
    const confirmation = await page.request.post("/api/auth/mfa/confirm", {
      data: { code: totp(secret) },
    })
    expect(confirmation.status()).toBe(200)
    const recoveryCodes: string[] = (await confirmation.json()).data
      .recoveryCodes
    await page.request.post("/api/auth/logout")
    const login = await page.request.post("/api/auth/login", {
      data: { username: `e2e_${id}`, password },
    })
    expect((await login.json()).data.requiresMfa).toBe(true)
    const cookies = (await page.context().cookies()).find(
      (c) => c.name === "custodysim_mfa_challenge",
    )!
    await page.goto("/mfa")
    await page.getByLabel("一次性验证码或恢复码").fill(recoveryCodes[0])
    await page.getByRole("button", { name: "验证并继续" }).click()
    await expect(page).toHaveURL(`${baseURL}/`)
    const replay = await other.post("/api/auth/mfa/verify", {
      headers: { Cookie: `${cookies.name}=${cookies.value}` },
      data: { code: recoveryCodes[1], trustDevice: true },
    })
    expect(replay.status()).toBe(400)
    await page.goto("/security")
    await expect(
      page.getByText("双重验证已启用", { exact: true }),
    ).toBeVisible()
    expect(
      await db
        .select()
        .from(s.mfaTrustedDevices)
        .where(eq(s.mfaTrustedDevices.userId, id)),
    ).toHaveLength(1)
  } finally {
    await other.dispose()
    await db.delete(s.auditLogs).where(eq(s.auditLogs.actorId, id))
    await db.delete(s.loginLogs).where(eq(s.loginLogs.userId, id))
    await db.delete(s.users).where(eq(s.users.id, id))
  }
})

test("邮箱绑定界面显示验证码、倒计时和重新登录提示（邮件接口替身）", async ({
  page,
  baseURL,
}, testInfo) => {
  const id = randomUUID()
  const password = "EmailBrowser12345"
  try {
    await db
      .insert(s.users)
      .values({
        id,
        username: `e2e_${id}`,
        name: "邮箱页面验证",
        role: "ADMIN",
        mustChangePassword: false,
        passwordHash: await hashPassword(password),
      })
    expect(
      (
        await page.request.post("/api/auth/login", {
          data: { username: `e2e_${id}`, password },
        })
      ).status(),
    ).toBe(200)
    await page.route("**/api/auth/security-email", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            bindingEnabled: true,
            configured: true,
            maskedEmail: null,
            verifiedAt: null,
          },
        },
      }),
    )
    await page.route("**/api/auth/security-email/send", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        email: "member@example.com",
        password,
      })
      await route.fulfill({
        json: {
          success: true,
          data: {
            challengeId: randomUUID(),
            maskedEmail: "m***@example.com",
            expiresIn: 300,
            resendAfter: 60,
          },
        },
      })
    })
    await page.route("**/api/auth/security-email/confirm", (route) =>
      route.fulfill({
        json: { success: true, data: { verified: true, requiresLogin: true } },
      }),
    )
    await page.goto("/security")
    await page
      .getByLabel("邮箱地址", { exact: true })
      .fill("member@example.com")
    await page.getByLabel("当前密码", { exact: true }).fill(password)
    await page.getByRole("button", { name: "发送邮箱验证码" }).click()
    await expect(
      page.getByText(/验证码已发送至 m\*\*\*@example.com/),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /秒后可重发/ }),
    ).toBeDisabled()
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue("")
    await page.screenshot({
      path: `.logs/security-email-${testInfo.project.name}.png`,
      fullPage: true,
    })
    await page.getByLabel("邮箱验证码", { exact: true }).fill("123456")
    await page.getByRole("button", { name: "确认绑定", exact: true }).click()
    await expect(
      page.getByText(/邮箱验证成功，旧会话和受信任设备已撤销/),
    ).toBeVisible()
    await page.context().clearCookies()
    await page.getByRole("button", { name: "重新登录", exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/login`)
  } finally {
    await db.delete(s.loginLogs).where(eq(s.loginLogs.userId, id))
    await db.delete(s.users).where(eq(s.users.id, id))
  }
})
