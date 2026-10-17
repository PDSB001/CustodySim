import { defineConfig } from "@playwright/test"
import base from "./playwright.config"

const servers = base.webServer
if (!Array.isArray(servers) || !servers[0]?.env?.DATABASE_URL)
  throw new Error("Missing isolated E2E server configuration")
const baseURL = process.env.E2E_PRODUCTION_BASE_URL ?? "http://127.0.0.1:3110"
const target = new URL(baseURL)
if (
  target.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  target.pathname !== "/" ||
  target.search ||
  target.hash ||
  target.username ||
  target.password ||
  target.port === "0"
)
  throw new Error("Production browser regression requires a local HTTP origin")

export default defineConfig({
  ...base,
  testMatch: ["production-csp.spec.ts"],
  testIgnore: [],
  workers: 1,
  use: { ...base.use, baseURL },
  webServer: {
    command: "node scripts/start-production-e2e.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...servers[0].env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: target.port || "80",
      APP_ORIGIN: target.origin,
      AUTH_COOKIE_SECURE: "false",
      AUTH_SECRET: "csp-production-test-only-auth-secret-32-characters",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_TENCENT_MAP_KEY: "csp-test-placeholder",
      NEXT_PUBLIC_CHAT_REALTIME_URL: "",
    },
  },
})
