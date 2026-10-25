import { expect, test } from "@playwright/test"

test("通知中心紧凑展示合并名单，可筛选、展开并批量确认已阅", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { username: "rank_101_liu", password: "Demo12345" },
  })
  expect(login.ok()).toBe(true)
  const now = new Date().toISOString()
  const original = [
    {
      id: "aa000000-0000-4000-8000-000000000001",
      title: "禁闭公示",
      content: "两名人员的完整禁闭决定",
      targetRole: "ALL",
      priority: "IMPORTANT",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      readAt: null,
      metadata: {
        kind: "ISOLATION",
        period: "2026-10-19",
        entries: {
          a: {
            id: "a",
            name: "测试甲",
            score: -3,
            startAt: "2026-10-26T00:00:00+08:00",
            endAt: "2026-10-29T00:00:00+08:00",
            status: "ACTIVE",
            occurredAt: now,
          },
          b: {
            id: "b",
            name: "测试乙",
            score: -1,
            startAt: "2026-10-26T00:00:00+08:00",
            endAt: "2026-10-29T00:00:00+08:00",
            status: "CANCELLED",
            occurredAt: now,
          },
        },
      },
    },
    {
      id: "aa000000-0000-4000-8000-000000000002",
      title: "周末阅览安排",
      content: "本周末阅览室照常开放。请按时完成阅读任务，并保持阅览室安静。",
      targetRole: "ALL",
      priority: "NORMAL",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      readAt: null,
      metadata: null,
    },
  ]
  const readIds = new Set<string>()
  await page.route(/\/api\/notices(?:\?|$)/, async (route) => {
    const request = route.request()
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as {
        noticeIds: string[]
        versions: Record<string, string>
      }
      expect(body.noticeIds.length).toBeGreaterThan(0)
      for (const id of body.noticeIds) {
        expect(body.versions[id]).toBe(now)
        readIds.add(id)
      }
      await route.fulfill({
        json: { success: true, data: { id: body.noticeIds[0] } },
      })
      return
    }
    const params = new URL(request.url()).searchParams
    const items = original
      .map((n) => ({ ...n, readAt: readIds.has(n.id) ? now : null }))
      .filter(
        (n) =>
          (!params.get("priority") || n.priority === params.get("priority")) &&
          (params.get("unread") !== "1" || !n.readAt) &&
          (!params.get("keyword") ||
            (n.title + n.content).includes(params.get("keyword")!)),
      )
    await route.fulfill({
      json: { success: true, data: { items, nextCursor: null } },
    })
  })
  await page.goto("/my/notices")
  await expect(page.getByTestId("notice-item")).toHaveCount(2)
  await expect(page.getByText(/2人：测试甲/)).toBeVisible()
  const bulletin = page
    .getByTestId("notice-item")
    .filter({ has: page.getByRole("heading", { name: "禁闭公示" }) })
  await expect(
    bulletin
      .locator("details")
      .getByText(/执行：/)
      .first(),
  ).not.toBeVisible()
  await bulletin.getByText("展开 2 条明细").click()
  await expect(bulletin.getByText(/已撤销禁闭/)).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath("notice-center.png"),
    fullPage: true,
  })
  await page.getByRole("button", { name: "重要", exact: true }).click()
  await expect(page.getByTestId("notice-item")).toHaveCount(1)
  await page.getByRole("button", { name: "全部", exact: true }).click()
  await page.getByLabel("搜索通知").fill("阅览")
  await expect(page.getByTestId("notice-item")).toHaveCount(1)
  await expect(
    page.getByRole("heading", { name: "周末阅览安排" }),
  ).toBeVisible()
  await page.getByLabel("搜索通知").fill("")
  await expect(page.getByTestId("notice-item")).toHaveCount(2)
  await page.getByRole("button", { name: "本页全部已阅" }).click()
  await expect.poll(() => readIds.size).toBe(2)
  await expect(page.getByText("已加载 2 条 · 0 条未读")).toBeVisible()
  await page.getByRole("button", { name: "未读", exact: true }).click()
  await expect(page.getByTestId("notice-item")).toHaveCount(0)
})

test("管理端发布表单按需展开，归档原文可查且不能直接重新发布", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { username: "rank_admin", password: "Demo12345" },
  })
  expect(login.ok()).toBe(true)
  const now = new Date().toISOString()
  await page.route(/\/api\/admin\/notices(?:\?|$)/, async (route) => {
    const archived =
      new URL(route.request().url()).searchParams.get("archived") === "1"
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: [
            {
              id: "aa000000-0000-4000-8000-000000000003",
              title: archived ? "禁闭检讨汇报 · 测试甲" : "禁闭检讨汇报",
              content: "测试甲的历史检讨原文完整保留。",
              targetRole: "ALL",
              priority: "IMPORTANT",
              createdAt: now,
              publishedAt: now,
              updatedAt: now,
              expiresAt: null,
              published: !archived,
              metadata: archived
                ? { archivedInto: "aa000000-0000-4000-8000-000000000001" }
                : null,
            },
          ],
          nextCursor: null,
        },
      },
    })
  })
  await page.goto("/notices")
  await expect(page.getByLabel("通知标题")).not.toBeVisible()
  await expect(page.getByTestId("notice-item")).toHaveCount(1)
  await page.getByRole("button", { name: "查看归档原通知" }).click()
  await expect(page.getByText("已归档", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "恢复发布" })).toHaveCount(0)
  await page.getByText("查看全文", { exact: true }).click()
  await expect(
    page.locator("details[open]").getByText("测试甲的历史检讨原文完整保留。"),
  ).toBeVisible()
  await page.getByText("发布新通知", { exact: true }).click()
  await expect(page.getByLabel("通知标题")).toBeVisible()
  await page.getByLabel("通知标题").fill("测试通知")
  await page.getByLabel("通知内容").fill("测试执行时间和要求")
})
