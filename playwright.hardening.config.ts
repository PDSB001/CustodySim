import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

const servers = base.webServer
if (
  !Array.isArray(servers) ||
  !servers[0]?.env?.DATABASE_URL ||
  new URL(servers[0].env.DATABASE_URL).pathname !== "/custodysim_e2e"
)
  throw new Error(
    "Hardening browser tests require the isolated custodysim_e2e database",
  )
const baseURL = "http://127.0.0.1:3210"
process.env.E2E_HARDENING_DATABASE_URL = servers[0].env.DATABASE_URL
process.env.AUTH_SECRET = "custodysim-hardening-browser-test-only-secret"

export default defineConfig({
  ...base,
  testMatch: "hardening-browser.spec.ts",
  testIgnore: [],
  workers: 1,
  timeout: 90_000,
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", grep: /聊天翻看/, use: { ...devices["Pixel 7"] } },
  ],
  use: { ...base.use, baseURL },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3210",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...servers[0].env,
      AUTH_SECRET: process.env.AUTH_SECRET,
      CUSTODYSIM_E2E_BUILD: "true",
    },
  },
})
