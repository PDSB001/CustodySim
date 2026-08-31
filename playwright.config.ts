import { defineConfig, devices } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "dotenv"

function databaseIdentity(value: string) {
  const url = new URL(value)
  return `${url.protocol}//${url.hostname}:${url.port}/${url.pathname.replace(/^\//, "")}`
}

const localEnvPath = resolve(process.cwd(), ".env.local")
const localFileEnv = existsSync(localEnvPath)
  ? parse(readFileSync(localEnvPath))
  : {}
const businessDatabaseUrl =
  process.env.DATABASE_URL ?? localFileEnv.DATABASE_URL
const e2eDatabaseName =
  process.env.E2E_DATABASE_NAME ?? localFileEnv.E2E_DATABASE_NAME
if (e2eDatabaseName && !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(e2eDatabaseName))
  throw new Error("E2E_DATABASE_NAME 只能包含字母、数字和下划线")
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  localFileEnv.E2E_DATABASE_URL ??
  (businessDatabaseUrl && e2eDatabaseName
    ? (() => {
        const url = new URL(businessDatabaseUrl)
        url.pathname = `/${e2eDatabaseName}`
        return url.toString()
      })()
    : undefined)
if (!e2eDatabaseUrl)
  throw new Error("运行 E2E 前必须配置 E2E_DATABASE_NAME 或 E2E_DATABASE_URL")
if (
  businessDatabaseUrl &&
  databaseIdentity(businessDatabaseUrl) === databaseIdentity(e2eDatabaseUrl)
)
  throw new Error("E2E_DATABASE_URL 不能与 .env.local 的业务数据库相同")

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
)
const e2eEnv = {
  ...localFileEnv,
  ...inheritedEnv,
  DATABASE_URL: e2eDatabaseUrl,
}

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
      env: e2eEnv,
    },
    {
      command: "node realtime-server.mjs",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: true,
      timeout: 30_000,
      env: e2eEnv,
    },
  ],
})
