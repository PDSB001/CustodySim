import { randomUUID } from "node:crypto"
import { test, expect } from "@playwright/test"
import { config } from "dotenv"
import bcrypt from "bcryptjs"
import pg from "pg"
import { resolveE2eDatabaseTarget } from "../scripts/e2e-database-target.mjs"

let pool: pg.Pool
const usernames: string[] = []
test.beforeAll(async () => {
  config({ path: ".env.local", quiet: true })
  const target = resolveE2eDatabaseTarget({
    businessDatabaseUrl: process.env.DATABASE_URL,
    explicitE2eDatabaseUrl: process.env.E2E_DATABASE_URL,
  })
  pool = new pg.Pool({ connectionString: target.e2eUrl.toString() })
  expect(
    (await pool.query("select current_database() as name")).rows[0]?.name,
  ).toBe("custodysim_e2e")
})
test.afterAll(async () => {
  if (!pool) return
  try {
    const rows = await pool.query(
      "select id from users where username=any($1::text[])",
      [usernames],
    )
    const ids = rows.rows.map((row) => row.id)
    if (ids.length) {
      await pool.query(
        "delete from checkin_daily_scores where supervised_id=any($1::uuid[])",
        [ids],
      )
      await pool.query(
        "delete from checkin_tasks where supervised_id=any($1::uuid[])",
        [ids],
      )
      await pool.query(
        "delete from report_tasks where supervised_id=any($1::uuid[])",
        [ids],
      )
      await pool.query(
        "delete from score_events where supervised_id=any($1::uuid[])",
        [ids],
      )
      await pool.query(
        "delete from score_week_reviews where supervised_id=any($1::uuid[])",
        [ids],
      )
      await pool.query("delete from login_logs where user_id=any($1::uuid[])", [
        ids,
      ])
      await pool.query(
        "delete from audit_logs where actor_id=any($1::uuid[]) or entity_id=any($1::uuid[])",
        [ids],
      )
      await pool.query("delete from users where id=any($1::uuid[])", [ids])
    }
  } finally {
    await pool.end()
  }
})
test("Web 自由注册自动登录，首页展示考察，管理员能看到注册账号", async ({
  page,
  browser,
}, testInfo) => {
  const suffix = randomUUID().replaceAll("-", "")
  const username = `browser_reg_${suffix}`
  const adminName = `browser_admin_${suffix}`
  usernames.push(username, adminName)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js*",
    async (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile={render(element, options){element.textContent='测试人机验证';const token=btoa(JSON.stringify({hostname:location.hostname,cdata:options.cData,timestamp:new Date().toISOString(),nonce:crypto.randomUUID()})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');setTimeout(()=>options.callback(token),0);return 'fixture';},remove(){}};`,
      }),
  )
  await page.setExtraHTTPHeaders({
    "x-real-ip": `198.19.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`,
  })
  await page.goto("/login")
  await page.getByRole("link", { name: "没有账号？注册被监管人账号" }).click()
  await expect(
    page.getByRole("heading", { name: "开始首周考察" }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("register.png"),
    fullPage: true,
  })
  await page.getByLabel("用户名", { exact: true }).fill(username)
  await page.getByLabel("显示名称", { exact: true }).fill("注册流程验证")
  await page.getByLabel("邮箱", { exact: true }).fill(`${suffix}@example.com`)
  await page.locator("#register-password").fill("Browser12345")
  await page.getByLabel("确认密码", { exact: true }).fill("Browser12345")
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "注册并进入系统" }).click()
  await expect(page).toHaveURL(/\/my$/)
  await expect(page.getByLabel("首周考察", { exact: true })).toBeVisible()
  await expect(page.getByText("已结算积分：0")).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("probation-home.png"),
    fullPage: true,
  })
  await page.getByRole("link", { name: "查看积分与规则" }).click()
  await expect(
    page.getByRole("heading", { name: "考核记分与禁闭" }),
  ).toBeVisible()
  const adminId = randomUUID()
  await pool.query(
    "insert into users (id,username,name,password_hash,role,must_change_password) values ($1,$2,$3,$4,'ADMIN',false)",
    [
      adminId,
      adminName,
      "注册验证管理员",
      await bcrypt.hash("Browser12345", 12),
    ],
  )
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  })
  try {
    const base = new URL(page.url()).origin
    const login = await context.request.post("/api/auth/login", {
      headers: { origin: base },
      data: { username: adminName, password: "Browser12345" },
    })
    expect(login.ok()).toBe(true)
    const admin = await context.newPage()
    await admin.goto("/registration")
    await expect(
      admin.getByRole("heading", { name: "注册与首周考察" }),
    ).toBeVisible()
    await expect(admin.getByText(`注册流程验证 · ${username}`)).toBeVisible()
  } finally {
    await context.close()
  }
  expect(errors).toEqual([])
})
