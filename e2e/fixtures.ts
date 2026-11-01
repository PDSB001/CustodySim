import { test as base, type Page } from "@playwright/test"
export * from "@playwright/test"

/** Older business journeys explicitly skip onboarding, as a returning user would. */
export async function installGettingStartedHandler(page: Page) {
  await page.addLocatorHandler(
    page.getByRole("dialog").filter({ hasText: "新手引导" }),
    async (dialog) => {
      await dialog.getByRole("button", { name: "跳过", exact: true }).click()
    },
  )
}

export const test = base.extend({
  page: async ({ page }, runTest) => {
    await installGettingStartedHandler(page)
    await runTest(page)
  },
})
