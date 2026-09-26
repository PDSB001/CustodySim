import { expect, test } from "@playwright/test"

async function login(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
) {
  const dedicatedAccounts: Record<
    string,
    { username: string; password: string }
  > = {
    admin: { username: "rank_admin", password: "Demo12345" },
    supervisor: { username: "rank_supervisor", password: "Demo12345" },
    user: { username: "rank_101_liu", password: "Demo12345" },
  }
  const credentials = dedicatedAccounts[username] ?? { username, password }
  await page.goto("/login")
  await page.getByLabel("账号").fill(credentials.username)
  await page.getByLabel("密码").fill(credentials.password)
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

async function openNavigationOnMobile(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: "打开导航", exact: true })
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await expect(trigger).toBeVisible()
    await trigger.click()
  }
}

test("管理员进入管理控制台", async ({ page }) => {
  await login(page, "admin", "admin123")
  await expect(page).toHaveURL("/")
  // 首页「快捷管理」区改成短标签后，这里断言分类标题 + 其中的组织架构入口，
  // 比钉死某个"标题 说明"长串更稳（说明文案仍可能调整）。
  await expect(page.getByRole("heading", { name: "快捷管理" })).toBeVisible()
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
    page.getByRole("link", { name: "服刑任务", exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel("今日打卡")).toBeVisible()
})

test("移动尺寸登录后保留会话并进入个人服务台", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "user", "user12345")
  await expect(page).toHaveURL("/my")
  await expect(page.getByRole("heading", { name: "刘晨，监室日程" })).toBeVisible()
  await expect(page.getByLabel("今日打卡")).toBeVisible()
})

test("移动端头像菜单提供退出登录", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "user", "user12345")
  await page.getByLabel("打开账号菜单").click()
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeVisible()
})

test("每个账号可从账号菜单进入修改密码", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.getByLabel("打开账号菜单").click()
  await page.getByRole("menuitem", { name: "修改密码" }).click()
  await expect(page).toHaveURL("/change-password")
  await expect(page.getByLabel("当前密码", { exact: true })).toBeVisible()
  await expect(page.getByLabel("新密码", { exact: true })).toBeVisible()
  await expect(page.getByLabel("确认新密码", { exact: true })).toBeVisible()
})

test("被监管者可以进入打卡记录", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/checkins")
  await expect(page).toHaveURL("/my/checkins")
  await expect(page.getByRole("heading", { name: "点名记录" })).toBeVisible()
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
  await expect(page.getByRole("heading", { name: "申诉与呈报" })).toBeVisible()
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

test("在押档案的刑期日期使用私有日历控件", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/profile")
  await expect(page.getByRole("heading", { name: "在押档案" })).toBeVisible()

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
  await expect(page.getByRole("heading", { name: "点名记录" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "历史打卡记录" }),
  ).toBeVisible()
  const picker = page.getByLabel("查询历史打卡日期")
  await picker.click()
  await expect(page.locator(".app-date-picker__popper")).toBeVisible()
  await expect(page.locator('input[type="date"]')).toHaveCount(0)
})

test("监管侧可以从汇总下钻查看某人的打卡明细", async ({ page }) => {
  await login(page, "admin", "admin123")
  // 管理侧支持 ?date= 直达；未选日期时汇总表不渲染（`enabled: Boolean(date)`），也就没有下钻入口。
  const today = new Date().toLocaleDateString("en-CA")
  await page.goto(`/supervision/checkins?date=${today}`)
  await expect(
    page.getByRole("heading", { name: "历史打卡记录" }),
  ).toBeVisible()

  const drill = page.getByRole("button", { name: /打卡记录/ }).first()
  // 造数不同（该日期可能没有在押人员）时跳过，避免把种子数据差异当成回归。
  if ((await drill.count()) === 0)
    test.skip(true, "该日期下没有可下钻的人员")

  await drill.click()
  await expect(page.getByRole("heading", { name: /的打卡记录$/ })).toBeVisible()
  // 明细弹层内的日期控件仍是私有日历控件（项目约定：不出现原生 input[type=date]）。
  await expect(page.getByLabel("明细起始日期")).toBeVisible()
  await expect(page.locator('input[type="date"]')).toHaveCount(0)
})

test("监管者可在任务页切换待审队列与批阅记录", async ({ page }) => {
  await login(page, "supervisor", "supervisor123")
  await page.goto("/supervisor/tasks")
  await page.getByText("批阅记录", { exact: true }).first().click()
  await expect(page.getByRole("heading", { name: "批阅记录" })).toBeVisible()
  // 筛选器与数据无关，是这段 UI 的确定性断言（批阅人 + 日期范围）。
  await expect(page.getByLabel("批阅人筛选")).toBeVisible()
  await expect(page.getByLabel("批阅起始日期")).toBeVisible()
})

test("批阅记录可展开查看当次提交内容", async ({ page }) => {
  await login(page, "supervisor", "supervisor123")
  await page.goto("/supervisor/tasks")
  await page.getByText("批阅记录", { exact: true }).first().click()
  // 「查看当次提交内容」要有历史记录才在；种子里没有就跳过，别把造数差异当回归。
  const expand = page.getByRole("button", { name: "查看当次提交内容" }).first()
  if ((await expand.count()) === 0)
    test.skip(true, "种子数据中没有批阅记录可供展开")

  await expand.click()
  await expect(page.getByRole("button", { name: "收起提交内容" })).toBeVisible()
})

test("补点核准默认仍是待审队列，并提供审核状态筛选", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/supervision/makeups")
  await expect(page.getByRole("heading", { name: "补点核准" })).toBeVisible()
  // 默认值与接口默认一致（PENDING）：既有观感不变，另给已审回看的入口。
  await expect(page.getByLabel("补卡审核状态筛选")).toBeVisible()
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
  await expect(page.getByRole("heading", { name: "监所通知" })).toBeVisible()
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

test("管理员可按人员切换电子围栏配置对象", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/electronic-fences")
  await page.getByRole("combobox").click()
  await expect(
    page.getByRole("option", { name: "默认围栏（未单独设置人员使用）" }),
  ).toBeVisible()
  await expect(
    page.getByRole("option", { name: /示范被监管人 · (使用默认|已单独设置)/ }),
  ).toBeVisible()
})

test("管理员可查看并编辑电子围栏越界说明系统模板", async ({ page }) => {
  await login(page, "admin", "admin123")
  await page.goto("/report-templates")
  await expect(
    page.getByRole("heading", { name: "任务表单模板" }),
  ).toBeVisible()

  const templateName = "电子围栏越界说明"
  const editTemplate = page.getByLabel(`编辑模板：${templateName}`)
  await expect(editTemplate).toBeVisible()
  await editTemplate.click()
  await expect(page.locator("input").first()).toHaveValue(templateName)
  await expect(page.locator("input").first()).toBeDisabled()
  await expect(page.getByRole("button", { name: "保存模板修改" })).toBeVisible()
  await expect(page.getByLabel(`删除模板：${templateName}`)).toBeDisabled()
})

test("填写任务会自动保存草稿", async ({ page }) => {
  await login(page, "user", "user12345")
  const taskId = "11111111-1111-4111-8111-111111111111"
  let savedDraft: unknown
  await page.route("**/api/tasks", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: [
          {
            id: taskId,
            title: "草稿保存验证",
            supervisedName: "示范被监管人",
            scheduleAt: "2026-08-27T08:00:00.000Z",
            deadline: "2099-08-28T08:00:00.000Z",
            status: "PENDING",
            templateSnapshot: {
              name: "草稿测试模板",
              content: null,
              fields: [
                {
                  name: "填写说明",
                  type: "TEXT",
                  required: true,
                  options: [],
                },
              ],
            },
            submissionId: null,
            content: null,
            data: null,
            officialSealData: null,
          },
        ],
      },
    })
  })
  await page.route("**/api/submissions/draft", async (route) => {
    savedDraft = route.request().postDataJSON()
    await route.fulfill({
      json: {
        success: true,
        data: { id: "22222222-2222-4222-8222-222222222222" },
      },
    })
  })

  await page.goto("/my/tasks")
  await page.locator('input[type="text"]').first().fill("已填写的原因")
  await expect
    .poll(() => savedDraft)
    .toEqual({
      taskId,
      data: { 填写说明: "已填写的原因" },
    })
  await expect(page.getByText("草稿已自动保存")).toBeVisible()
})

test("被监管者可以进入正式通知页", async ({ page }) => {
  await login(page, "user", "user12345")
  await page.goto("/my/notices")
  await expect(page).toHaveURL("/my/notices")
  await expect(page.getByRole("heading", { name: "监所公示" })).toBeVisible()
})
