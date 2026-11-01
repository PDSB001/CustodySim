import { defineConfig } from "@playwright/test"
import base from "./playwright.config"

const servers = base.webServer
if (
  !Array.isArray(servers) ||
  !servers[0]?.env?.DATABASE_URL ||
  new URL(servers[0].env.DATABASE_URL).pathname !== "/custodysim_e2e"
)
  throw new Error("Release browser checks require custodysim_e2e")
const baseURL = "http://127.0.0.1:3210"
process.env.E2E_BASE_URL = baseURL
const env = {
  ...servers[0].env,
  AUTH_SECRET: "custodysim-release-browser-only-test-secret",
  APP_ORIGIN: baseURL,
  CUSTODYSIM_E2E_BUILD: "true",
  NEXT_PUBLIC_CHAT_REALTIME_URL: "http://127.0.0.1:3211",
  REALTIME_PORT: "3211",
  UMENG_PUSH_ENABLED: "false",
  UMENG_APP_KEY: "",
  UMENG_APP_MASTER_SECRET: "",
}
export default defineConfig({
  ...base,
  workers: 2,
  use: { ...base.use, baseURL },
  webServer: [
    {
      command:
        "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3210",
      url: `${baseURL}/login`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node realtime-server.mjs",
      url: "http://127.0.0.1:3211/health",
      env,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
