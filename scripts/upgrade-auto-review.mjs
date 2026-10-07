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
  application_name: "custodysim-auto-review-upgrade",
  connectionTimeoutMillis: 10_000,
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expectedDatabase)
    throw new Error("数据库名称不匹配，未做修改")
  const sql = await readFile(
    new URL(
      "../lib/db/upgrades/20261007-auto-review-makeup.up.sql",
      import.meta.url,
    ),
    "utf8",
  )
  await client.query(sql)
  const { rows: verification } = await client.query(`
    SELECT
      to_regclass('public.auto_review_settings') AS settings,
      to_regclass('public.auto_review_runs') AS task_runs,
      to_regclass('public.auto_review_makeup_runs') AS makeup_runs,
      (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='auto_review_settings'
         AND column_name='provider') AS provider_default
  `)
  const row = verification[0]
  if (
    !row?.settings ||
    !row.task_runs ||
    !row.makeup_runs ||
    !String(row.provider_default).includes("bigmodel")
  )
    throw new Error("自动审核数据库升级验证失败")
  console.log(`auto-review tables ready in ${expectedDatabase}`)
} finally {
  await client.end()
}
