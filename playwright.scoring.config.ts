import { defineConfig } from "@playwright/test"
import base from "./playwright.config"

const servers = base.webServer
if (!Array.isArray(servers) || !servers[0]?.env?.DATABASE_URL)
  throw new Error("Missing isolated E2E server configuration")
const databaseUrl = servers[0].env.DATABASE_URL
if (new URL(databaseUrl).pathname !== "/custodysim_e2e")
  throw new Error("Scoring E2E requires custodysim_e2e")
// Both Playwright workers and the fresh Next server must use the same database.
process.env.E2E_SCORING_DATABASE_URL = databaseUrl

export default defineConfig({
  ...base,
  testMatch: "scoring-browser.spec.ts",
  testIgnore: "**/scoring/**/*.test.ts",
  workers: 1,
  timeout: 90_000,
  webServer: { ...servers[0], reuseExistingServer: false },
})
