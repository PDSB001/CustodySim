import { expect, test } from "@playwright/test"

test("补卡待审提示转人工原因，人工通过后历史保留 AI 原因及审核人", async ({
  page,
}) => {
  const automatic = {
    id: "auto-review-1",
    status: "MANUAL",
    result: "MANUAL",
    reason: "补卡包含图片凭证，请人工核验",
    model: "glm-4.5-flash",
    createdAt: "2026-10-07T14:00:44Z",
    isCurrent: true,
  }
  const makeup = {
    id: "3acc2917-386c-4fcc-a72d-e1f5fdaa1f71",
    taskId: "72fda56a-e912-40ef-9419-c5917f1eb75a",
    userName: "测试人员",
    ruleName: "补卡追溯验证",
    reason: "点名时手机没电，充电后申请补卡。",
    status: "PENDING",
    reviewComment: null as string | null,
    reviewedAt: null as string | null,
    createdAt: "2026-10-07T14:00:15Z",
    autoReviewReason: automatic.reason as string | null,
    autoReviewHistory: [automatic],
    reviewHistory: [] as Array<{
      id: string
      actorName: string
      actorType: string
      result: string
      comment: string
      createdAt: string
      isCurrent: boolean
    }>,
  }
  await page.route("**/api/makeups?status=*", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status")
    await route.fulfill({
      json: {
        success: true,
        data: status === makeup.status || status === "ALL" ? [makeup] : [],
      },
    })
  })
  await page.route(`**/api/makeups/${makeup.id}`, async (route) => {
    makeup.status = "APPROVED"
    makeup.reviewedAt = "2026-10-07T14:05:04Z"
    makeup.reviewComment = route.request().postDataJSON().comment
    makeup.autoReviewReason = null
    makeup.reviewHistory.push({
      id: "human-review-1",
      actorName: "王监管员",
      actorType: "USER",
      result: "APPROVED",
      comment: makeup.reviewComment!,
      createdAt: makeup.reviewedAt,
      isCurrent: true,
    })
    await route.fulfill({ json: { success: true, data: { id: makeup.id } } })
  })
  await page.goto("/login")
  await page.getByLabel("账号").fill("rank_admin")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).not.toHaveURL(/\/login$/)
  await page.goto("/supervision/tasks?tab=makeups")
  await expect(
    page.getByRole("status").filter({ hasText: automatic.reason }),
  ).toBeVisible()
  await expect(page.getByText("待审核", { exact: true }).last()).toBeVisible()
  await page.locator("summary").filter({ hasText: "审核轨迹" }).click()
  await expect(
    page.getByText(`配置模型：${automatic.model}`, { exact: false }),
  ).toBeVisible()
  await page
    .getByPlaceholder("可选", { exact: true })
    .fill("凭证有效，同意补卡")
  await page.getByRole("button", { name: "通过补卡" }).click()
  await expect(page.getByText("补点核准已完成", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "批阅记录" }).click()
  await page.getByRole("tab", { name: "补卡记录" }).click()
  await expect(
    page.getByText("最终审核：已通过", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("审核意见：凭证有效，同意补卡", { exact: true }),
  ).toBeVisible()
  await page.locator("summary").filter({ hasText: "审核轨迹" }).click()
  await expect(
    page
      .getByRole("list", { name: "补卡审核轨迹" })
      .getByText(automatic.reason, { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole("list", { name: "补卡审核轨迹" })
      .getByText("审核人：王监管员", { exact: false }),
  ).toBeVisible()
})
