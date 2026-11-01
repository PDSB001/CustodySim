import { randomUUID } from "node:crypto"
import { test, expect, type Page } from "@playwright/test"
import pg from "pg"
import { signToken, signMfaChallenge } from "../lib/auth"

let pool: pg.Pool
const id = randomUUID()
test.beforeAll(async () => {
  const url = process.env.E2E_HARDENING_DATABASE_URL
  if (!url || new URL(url).pathname !== "/custodysim_e2e")
    throw new Error("Requires isolated browser config")
  pool = new pg.Pool({ connectionString: url })
  expect(
    (await pool.query("select current_database() name")).rows[0].name,
  ).toBe("custodysim_e2e")
  await pool.query(
    "insert into users(id,username,name,password_hash,role,must_change_password) values($1,$2,$3,$4,'ADMIN',false)",
    [id, `ui_${id}`, "交互回归", "unused"],
  )
})
test.afterAll(async () => {
  if (!pool) return
  await pool.query("delete from users where id=$1", [id])
  await pool.end()
})
async function authenticate(page: Page, baseURL: string) {
  await page
    .context()
    .addCookies([
      {
        name: "custodysim_session",
        value: await signToken({ userId: id, tokenVersion: 0, role: "ADMIN" }),
        url: baseURL,
        httpOnly: true,
      },
    ])
  await page.addInitScript(
    (userId) =>
      localStorage.setItem(`custodysim:guide:v1:${userId}:ADMIN`, "seen"),
    id,
  )
}
const ok = (data: unknown) => ({
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
})

test("发布成功清空文件，按钮禁用；退出请求失败可见且可重试", async ({
  page,
  baseURL,
}) => {
  await authenticate(page, baseURL!)
  let uploads = 0,
    logoutAttempts = 0
  await page.route("**/api/admin/app-release", async (route) => {
    if (route.request().method() === "PUT") {
      uploads++
      await route.fulfill(ok({ size: 8, sha256: "fixture" }))
    } else
      await route.fulfill(ok({ available: false, size: 0, updatedAt: null }))
  })
  await page.route("**/api/auth/logout", async (route) => {
    logoutAttempts++
    await route.abort("failed")
  })
  await page.goto("/app-release")
  await page
    .getByLabel("APK 文件（最多 256 MB）")
    .setInputFiles({
      name: "app.apk",
      mimeType: "application/vnd.android.package-archive",
      buffer: Buffer.from("test-apk"),
    })
  await page.getByRole("button", { name: "上传并发布", exact: true }).click()
  await expect(page.getByText("APK 已发布，下载页已更新。")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "上传并发布", exact: true }),
  ).toBeDisabled()
  await expect(page.getByLabel("APK 文件（最多 256 MB）")).toHaveValue("")
  expect(uploads).toBe(1)
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByRole("button", { name: "打开账号菜单" }).click()
    await page.getByRole("menuitem", { name: "退出登录" }).click()
    await expect(
      page.getByText("退出登录未完成，请检查网络后重试").first(),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "打开账号菜单" }),
    ).toBeEnabled()
    expect(logoutAttempts).toBe(attempt)
    await expect(page).toHaveURL(/\/app-release$/)
  }
})

test("上传中离开页面不触发额外状态查询", async ({ page, baseURL }) => {
  await authenticate(page, baseURL!)
  let reads = 0,
    started!: () => void,
    release!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/admin/app-release", async (route) => {
    if (route.request().method() === "GET") {
      reads++
      await route.fulfill(ok({ available: false, size: 0, updatedAt: null }))
      return
    }
    started()
    await gate
    await route.abort().catch(() => {})
  })
  await page.goto("/app-release")
  await expect(page.getByText("尚未发布安装包")).toBeVisible()
  const before = reads
  await page
    .getByLabel("APK 文件（最多 256 MB）")
    .setInputFiles({
      name: "app.apk",
      mimeType: "application/vnd.android.package-archive",
      buffer: Buffer.from("test-apk"),
    })
  await page.getByRole("button", { name: "上传并发布", exact: true }).click()
  await ready
  try {
    await page.getByRole("button", { name: "安全与审计", exact: true }).click()
    await page.getByRole("link", { name: "操作审计", exact: true }).click()
    await expect(page).toHaveURL(/\/audit-logs$/)
    release()
    await expect(
      page.getByRole("heading", { name: "操作审计", exact: true }),
    ).toBeVisible()
    expect(reads).toBe(before)
  } finally {
    release()
  }
})

test("MFA 默认不信任设备，点击文字能切换，明确 false 随请求提交", async ({
  page,
  baseURL,
}) => {
  await page
    .context()
    .addCookies([
      {
        name: "custodysim_mfa_challenge",
        value: await signMfaChallenge(id, 0, randomUUID()),
        url: baseURL!,
        httpOnly: true,
      },
    ])
  let submitted: unknown
  await page.route("**/api/auth/mfa/verify", async (route) => {
    submitted = route.request().postDataJSON()
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { message: "测试验证码" },
      }),
    })
  })
  await page.goto("/mfa")
  const checkbox = page.getByRole("checkbox", {
    name: /在此设备信任登录验证 30 天/,
  })
  await expect(checkbox).not.toBeChecked()
  await page.locator('label[for="mfa-trust-device"]').click()
  await expect(checkbox).toBeChecked()
  await page.locator('label[for="mfa-trust-device"]').click()
  await expect(checkbox).not.toBeChecked()
  await page.getByLabel("一次性验证码或恢复码").fill("123456")
  await page.getByRole("button", { name: "验证并继续" }).click()
  await expect(page.getByText("测试验证码")).toBeVisible()
  expect(submitted).toMatchObject({ trustDevice: false })
})

test("聊天翻看与前插历史保持位置；新消息不抢滚动，贴底后合并已读", async ({
  page,
  baseURL,
}) => {
  await authenticate(page, baseURL!)
  const conversation = randomUUID()
  const message = (n: number) => ({
    id: `message-${n}`,
    senderId: "other",
    senderName: "对方",
    type: "TEXT",
    content: `消息 ${n} 内容`,
    recalledAt: null,
    createdAt: new Date(2026, 9, 1, 0, n).toISOString(),
    readCount: 0,
  })
  const initial = Array.from({ length: 50 }, (_, n) => message(n + 50))
  const older = Array.from({ length: 50 }, (_, n) => message(n))
  let incoming: ReturnType<typeof message>[] = []
  const receipts: string[] = []
  await page.route("**/api/chat/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/realtime-token")) {
      await route.fulfill({ status: 503, ...ok(null) })
      return
    }
    if (url.pathname.endsWith("/messages")) {
      await route.fulfill(
        ok(
          url.searchParams.has("before")
            ? older
            : url.searchParams.has("after")
              ? incoming
              : initial,
        ),
      )
      return
    }
    if (url.pathname.endsWith("/read")) {
      const body = route.request().postDataJSON()
      receipts.push(body.messageId)
      await route.fulfill(ok({ messageId: body.messageId }))
      return
    }
    await route.fulfill(
      ok(
        url.pathname.endsWith("/conversations")
          ? [
              {
                id: conversation,
                type: "DIRECT",
                title: "回归会话",
                roomOrganizationId: null,
                members: [],
                lastMessage: null,
                unreadCount: 0,
                muted: false,
              },
            ]
          : [],
      ),
    )
  })
  await page.goto("/chats")
  const viewport = page.getByRole("log", { name: "聊天消息" })
  await expect(page.getByText("消息 99 内容", { exact: true })).toBeVisible()
  await expect.poll(() => receipts.length).toBe(1)
  await viewport.evaluate((element) => {
    element.scrollTop = 160
    element.dispatchEvent(new Event("scroll"))
  })
  const anchor = await viewport.evaluate((element) => {
    const top = element.getBoundingClientRect().top
    const row = [
      ...element.querySelectorAll<HTMLElement>("[data-chat-message]"),
    ].find((item) => item.getBoundingClientRect().bottom > top)!
    return {
      id: row.dataset.chatMessage!,
      top: row.getBoundingClientRect().top,
    }
  })
  await page
    .getByRole("button", { name: "加载更早消息" })
    .evaluate((element) => (element as HTMLButtonElement).click())
  await expect(page.locator('[data-chat-message="message-0"]')).toBeAttached()
  await expect
    .poll(async () =>
      Math.abs(
        (await page
          .locator(`[data-chat-message="${anchor.id}"]`)
          .evaluate((element) => element.getBoundingClientRect().top)) -
          anchor.top,
      ),
    )
    .toBeLessThan(2)
  const position = await viewport.evaluate((element) => element.scrollTop)
  incoming = [message(100), message(101), message(102)]
  await expect(page.locator('[data-chat-message="message-102"]')).toBeAttached({
    timeout: 15000,
  })
  expect(
    Math.abs(
      (await viewport.evaluate((element) => element.scrollTop)) - position,
    ),
  ).toBeLessThan(2)
  expect(receipts).toHaveLength(1)
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event("scroll"))
  })
  await expect.poll(() => receipts.length).toBe(2)
  expect(receipts[1]).toBe("message-102")
})
