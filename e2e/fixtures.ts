import { test as base, type Page } from "@playwright/test"
export * from "@playwright/test"

/** Business journeys start with a returning user's onboarding storage state. */
export async function prepareReturningUser(page: Page) {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      // Seed only the exact onboarding namespace; leave all other storage real.
      // The dedicated getting-started spec uses the unmodified base fixture.
      if (
        key.startsWith("custodysim:guide:v1:") &&
        read.call(this, key) === null
      )
        this.setItem(key, "seen")
      return read.call(this, key)
    }
  })
}

export const test = base.extend({
  page: async ({ page }, runTest) => {
    await prepareReturningUser(page)
    await runTest(page)
  },
})
