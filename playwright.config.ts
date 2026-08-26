import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000"
const port = new URL(baseURL).port || "3000"

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node ./node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
