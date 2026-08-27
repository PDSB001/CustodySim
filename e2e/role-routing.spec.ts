import { expect, test } from "@playwright/test"

async function login(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
) {
  await page.goto("/login")
  await page.getByLabel("账号").fill(username)
  await page.getByLabel("密码").fill(password)
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

async function openNavigationOnMobile(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: "打开导航", exact: true })
  if (await trigger.isVisible()) await trigger.click()
}

test("管理员进入管理控制台", async ({ page }) => {
  await login(page, "admin", "admin123")
  await expect(page).toHaveURL("/")
  await openNavigationOnMobile(page)
  await expect(
    page.getByRole("link", { name: "组织架构", exact: true }),
  ).toBeVisible()
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
  await openNavigationOnMobile(page)
  await expect(
    page.getByRole("link", { name: "我的任务", exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel("今日打卡")).toBeVisible()
})

test("移动尺寸登录后保留会话并进入个人服务台", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "user", "user12345")
  await expect(page).toHaveURL("/my")
  await expect(
    page.getByRole("heading", { name: "你好，示范被监管人" }),
  ).toBeVisible()
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

test("被监管者可以查看电子围栏说明", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/electronic-fence")
  await expect(page).toHaveURL("/my/electronic-fence")
  await expect(page.getByRole("heading", { name: "电子围栏" })).toBeVisible()
})

test("被监管者可以进入申请页并看到私有请假时间控件", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/applications")
  await expect(page).toHaveURL("/my/applications")
  await expect(page.getByRole("heading", { name: "我的申请" })).toBeVisible()
  await expect(page.getByLabel("请假开始时间", { exact: true })).toBeVisible()
  await expect(page.getByLabel("请假结束时间", { exact: true })).toBeVisible()
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0)
})

test("私有日期时间控件通过日历弹层选择时间", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/applications")
  const picker = page.getByLabel("请假开始时间", { exact: true })

  await picker.click()
  await expect(page.locator(".react-datepicker")).toBeVisible()
  await expect(page.locator(".app-date-picker__popper")).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator(".app-date-picker__calendar")
        .evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("date-picker-pop-in")
  await expect(page.getByRole("listbox", { name: "时间" })).toBeVisible()
  await page.getByText("此刻", { exact: true }).click()
  await expect(picker).not.toHaveValue("")
})

test("个人档案的刑期日期使用私有日历控件", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/profile")
  await expect(page.getByRole("heading", { name: "个人档案" })).toBeVisible()

  const sentenceStartDate = page.getByLabel("刑期起始日期", { exact: true })
  await expect(sentenceStartDate).toBeVisible()
  await expect(page.locator('input[type="date"]')).toHaveCount(0)
  await sentenceStartDate.click()
  await expect(page.locator(".react-datepicker")).toBeVisible()
})

test("全局选择器的选中底色覆盖完整行且对勾对齐", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/applications")
  await page.locator('[data-slot="select-trigger"]').first().click()
  const content = page.locator('[data-slot="select-content"]')
  const selected = page.locator(
    '[data-slot="select-item"][data-state="checked"]',
  )
  await expect(selected).toBeVisible()
  const [contentBox, selectedBox, indicatorBox] = await Promise.all([
    content.boundingBox(),
    selected.boundingBox(),
    selected.locator('[data-slot="select-item-indicator"]').boundingBox(),
  ])
  expect(contentBox).not.toBeNull()
  expect(selectedBox).not.toBeNull()
  expect(indicatorBox).not.toBeNull()
  expect(selectedBox!.width).toBeGreaterThanOrEqual(contentBox!.width - 16)
  expect(indicatorBox!.x + indicatorBox!.width).toBeLessThanOrEqual(
    selectedBox!.x + selectedBox!.width,
  )
  expect(indicatorBox!.x).toBeLessThanOrEqual(selectedBox!.x + 24)
})

test("被监管者不能进入申请审核页", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/applications")
  await expect(page).toHaveURL("/my")
})

test("监管者可以查看辖区日常打卡", async ({ page }) => {
  await login(page, "supervisor", "supervisor123")
  await page.goto("/supervisor/checkins")
  await expect(page).toHaveURL("/supervisor/checkins")
  await expect(page.getByRole("heading", { name: "日常打卡" })).toBeVisible()
})

test("监管者可以进入申请审核页", async ({ page }) => {
  await login(page, "supervisor", "supervisor123")
  await page.goto("/supervisor/applications")
  await expect(page).toHaveURL("/supervisor/applications")
  await expect(page.getByRole("heading", { name: "申请审核" })).toBeVisible()
})

test("管理员可以进入申请审核页", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/applications")
  await expect(page).toHaveURL("/applications")
  await expect(page.getByRole("heading", { name: "申请审核" })).toBeVisible()
})

test("管理员可以进入印章与通知中心", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/official-seals")
  await expect(page.getByRole("heading", { name: "印章中心" })).toBeVisible()
  await page.goto("/notices")
  await expect(page.getByRole("heading", { name: "通知中心" })).toBeVisible()
})

test("管理员可以查看档案并看到归档删除操作列", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/profile-records")
  await expect(page.getByRole("heading", { name: "档案记录" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "操作" })).toBeVisible()
})

test("管理员可以进入电子围栏配置", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/electronic-fences")
  await expect(page).toHaveURL("/electronic-fences")
  await expect(page.getByRole("heading", { name: "电子围栏" })).toBeVisible()
  await expect(page.getByText("围栏配置")).toBeVisible()
})

test("被监管者可以进入正式通知页", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/notices")
  await expect(page).toHaveURL("/my/notices")
  await expect(page.getByRole("heading", { name: "通知公告" })).toBeVisible()
})
