import { spawnSync } from "node:child_process"

import { config } from "dotenv"
import pg from "pg"

config({ path: ".env.local" })

const businessDatabaseUrl = process.env.DATABASE_URL
if (!businessDatabaseUrl) throw new Error(".env.local 未配置 DATABASE_URL")

const databaseName = process.env.E2E_DATABASE_NAME ?? "custodysim_e2e"
if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(databaseName))
  throw new Error("E2E_DATABASE_NAME 只能包含字母、数字和下划线")

const businessUrl = new URL(businessDatabaseUrl)
const businessDatabaseName = businessUrl.pathname.replace(/^\//, "")
if (businessDatabaseName === databaseName)
  throw new Error("E2E 数据库不能与业务数据库同名")

const e2eUrl = new URL(businessUrl)
e2eUrl.pathname = `/${databaseName}`

const { Client } = pg
const client = new Client({ connectionString: businessDatabaseUrl })
await client.connect()
try {
  const existing = await client.query(
    "select 1 from pg_database where datname = $1",
    [databaseName],
  )
  if (existing.rowCount === 0) {
    await client.query(
      `create database "${databaseName}" template template0 encoding 'UTF8'`,
    )
    console.log(`已创建 E2E 数据库：${databaseName}`)
  } else {
    console.log(`E2E 数据库已存在，继续复用：${databaseName}`)
  }
} finally {
  await client.end()
}

const childEnv = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: e2eUrl.toString(),
  E2E_DATABASE_URL: e2eUrl.toString(),
  ALLOW_DEMO_SEED: "true",
}

function run(args) {
  const command =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm"
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`命令执行失败：pnpm ${args.join(" ")}`)
}

run(["exec", "drizzle-kit", "push", "--config=drizzle.config.ts", "--force"])
run(["exec", "tsx", "scripts/ensure-entry-registration-form.ts"])
run(["exec", "tsx", "scripts/seed.ts"])
run(["exec", "tsx", "scripts/seed-scoreboard-demo.ts"])

console.log("E2E 数据库结构与测试账号初始化完成")
