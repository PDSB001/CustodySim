import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { config } from "dotenv"
import pg from "pg"
import { resolveE2eDatabaseTarget } from "./e2e-database-target.mjs"

config({ path: ".env.local", quiet: true })

const { databaseName, e2eUrl, maintenanceUrl } = resolveE2eDatabaseTarget({
  businessDatabaseUrl: process.env.DATABASE_URL,
  explicitE2eDatabaseUrl: process.env.E2E_DATABASE_URL,
  databaseName: process.env.E2E_DATABASE_NAME,
})

const { Client } = pg
// Database creation is cluster maintenance; never connect this initializer to
// the business database, even to inspect pg_database.
const client = new Client({ connectionString: maintenanceUrl.toString() })
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

const targetClient = new Client({ connectionString: e2eUrl.toString() })
await targetClient.connect()
try {
  const result = await targetClient.query("select current_database() as name")
  if (result.rows[0]?.name !== databaseName)
    throw new Error("E2E 数据库连接验证失败，拒绝初始化")
} finally {
  await targetClient.end()
}

const childEnv = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: e2eUrl.toString(),
  E2E_DATABASE_URL: e2eUrl.toString(),
  ALLOW_DEMO_SEED: "true",
}

function run(tool, args) {
  // Use the checked-in project's installed CLI with this Node runtime. Windows
  // pnpm.cmd/PATH and shell quoting must not prevent refreshing the test schema.
  const manifestPath = resolve("node_modules", tool, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[tool]
  const result = spawnSync(process.execPath, [resolve(dirname(manifestPath), bin), ...args], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`命令执行失败：${tool} ${args.join(" ")}`)
}

run("drizzle-kit", ["push", "--config=drizzle.config.ts", "--force"])
run("tsx", ["scripts/ensure-entry-registration-form.ts"])
run("tsx", ["scripts/seed.ts"])
run("tsx", ["scripts/seed-scoreboard-demo.ts"])

console.log("E2E 数据库结构与测试账号初始化完成")
