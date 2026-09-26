import { expect, test } from "@playwright/test"

test("人员列表按页加载，搜索回到第一页并可清除", async ({ page }) => {
  const items = Array.from({ length: 26 }, (_, index) => ({
    id: `person-${index + 1}`,
    name: `分页人员${index + 1}`,
    gender: null,
    age: null,
    personType: "SUPERVISED",
    prisonerNumber: null,
    customNumber: null,
    status: "active",
    custodyLevel: "GENERAL",
    custodyStatus: "OUT_OF_CUSTODY",
    organizationId: null,
    organizationName: null,
    userId: null,
    username: null,
    archiveRecordCount: 0,
    archiveStatus: "UNFILLED",
    createdAt: "2026-01-01T00:00:00Z",
  }))
  await page.route("**/api/admin/persons?*", async (route) => {
    const params = new URL(route.request().url()).searchParams
    expect(params.get("pageSize")).toBe("25")
    const filtered = items.filter((person) =>
      person.name.includes(params.get("q") ?? ""),
    )
    const currentPage = Number(params.get("page"))
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: filtered.slice((currentPage - 1) * 25, currentPage * 25),
          total: filtered.length,
          page: currentPage,
          pageSize: 25,
        },
      },
    })
  })
  await page.goto("/login")
  await page.getByLabel("账号").fill("rank_admin")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).not.toHaveURL(/\/login$/)
  await page.goto("/persons")
  const rows = page.locator("tbody tr")
  await expect(rows).toHaveCount(25)
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled()
  await page.getByRole("button", { name: "下一页", exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText("分页人员26")
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled()
  await page.getByRole("textbox", { name: "搜索人员" }).fill("分页人员1")
  await page.getByRole("button", { name: "搜索", exact: true }).click()
  await expect(rows).toHaveCount(11)
  await expect(
    page.getByRole("navigation", { name: "人员列表分页" }),
  ).toContainText("第 1 / 1 页")
  await page.getByRole("textbox", { name: "搜索人员" }).fill("无匹配人员")
  await page.getByRole("button", { name: "搜索", exact: true }).click()
  await expect(page.getByText("没有匹配的人员", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "清除", exact: true }).click()
  await expect(rows).toHaveCount(25)
})
