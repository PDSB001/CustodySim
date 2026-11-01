// Deliberately use the base fixture so onboarding is never automatically skipped.
import { test, expect } from "@playwright/test"

test("新手指引首次显示三步，完成后刷新不再自动弹出，仍可手动重看", async ({
  page,
}) => {
  await page.clock.install()
  const login = await page.request.post("/api/auth/login", {
    data: { username: "rank_admin", password: "Demo12345" },
  })
  expect(login.status()).toBe(200)
  const user = (await login.json()).data
  await page.goto("/")
  const dialog = page.getByRole("dialog").filter({ hasText: "新手引导" })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole("heading", { name: "配置组织与账号" }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "下一步" }).click()
  await expect(
    dialog.getByRole("heading", { name: "设置业务规则" }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "下一步" }).click()
  await expect(
    dialog.getByRole("heading", { name: "检查安全与联络" }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "开始使用" }).click()
  await expect(dialog).not.toBeVisible()
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `custodysim:guide:v1:${user.id}:ADMIN`,
    ),
  ).toBe("seen")
  await page.reload()
  await expect(page.getByRole("button", { name: "打开账号菜单" })).toBeEnabled()
  await page.clock.runFor(500)
  await expect(dialog).not.toBeVisible()
  await page.getByRole("button", { name: "打开新手引导" }).click()
  await expect(
    dialog.getByRole("heading", { name: "配置组织与账号" }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "跳过" }).click()
  await expect(dialog).not.toBeVisible()
})
