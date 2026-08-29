import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100"
const port = new URL(baseURL).port || "3000"

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `node ./node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port ${port}`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "node --env-file=.env.local realtime-server.mjs",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
