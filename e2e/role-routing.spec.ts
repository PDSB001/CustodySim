import { expect, test } from "@playwright/test"

async function login(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
) {
  await page.goto("/login")
  await page.getByLabel("用户名").fill(username)
  await page.getByLabel("密码").fill(password)
  await page.getByRole("button", { name: "登录系统" }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

test("管理员进入管理控制台", async ({ page }) => {
  await login(page, "admin", "admin123")
  await expect(page).toHaveURL("/")
  await expect(page.getByText("组织架构")).toBeVisible()
})

test("监管者进入监管工作台，不能进入管理区", async ({ page }) => {
  await login(page, "supervisor", "supervisor123")
  await expect(page).toHaveURL("/supervisor")
  await page.goto("/orgs")
  await expect(page).toHaveURL("/supervisor")
})

test("被监管者进入个人服务台", async ({ page }) => {
  await login(page, "user", "user12345")
  await expect(page).toHaveURL("/my")
  await expect(page.getByText("我的任务")).toBeVisible()
  await expect(page.getByLabel("今日打卡")).toBeVisible()
})

test("移动尺寸登录后保留会话并进入个人服务台", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "user", "user12345")
  await expect(page).toHaveURL("/my")
  await expect(page.getByRole("heading", { name: "你好，示范被监管人" })).toBeVisible()
  await expect(page.getByLabel("今日打卡")).toBeVisible()
})

test("移动端头像菜单提供退出登录", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "user", "user12345")
  await page.getByLabel("打开账号菜单").click()
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeVisible()
})

test("被监管者可以进入打卡记录", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/checkins")
  await expect(page).toHaveURL("/my/checkins")
  await expect(page.getByRole("heading", { name: "打卡记录" })).toBeVisible()
})

test("监管者可以查看辖区日常打卡", async ({ page }) => {
  await login(page, "supervisor", "supervisor123")
  await page.goto("/supervisor/checkins")
  await expect(page).toHaveURL("/supervisor/checkins")
  await expect(page.getByRole("heading", { name: "日常打卡" })).toBeVisible()
})
