import { readFile } from "node:fs/promises"
import { config } from "dotenv"
import pg from "pg"

config({ path: ".env.local", quiet: true })
const expectedDatabase = process.argv
  .find((arg) => arg.startsWith("--database="))
  ?.slice("--database=".length)
if (!expectedDatabase || !process.env.DATABASE_URL)
  throw new Error("需要 DATABASE_URL 和 --database=<目标数据库名>")

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: "custodysim-isolation-schedule-upgrade",
  connectionTimeoutMillis: 10_000,
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expectedDatabase)
    throw new Error("数据库名称不匹配，未做修改")
  const sql = await readFile(
    new URL("../lib/db/upgrades/20261006-isolation-schedule.up.sql", import.meta.url),
    "utf8",
  )
  try {
    await client.query(sql)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  }
  const { rows: settings } = await client.query(
    "SELECT schedule_time, timeout_minutes FROM public.isolation_settings WHERE id = 'default'",
  )
  console.log(JSON.stringify({ database: expectedDatabase, settings: settings[0], backupSchema: "custodysim_backup_isolation_20261006" }))
} finally {
  await client.end()
}
