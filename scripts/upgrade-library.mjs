import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

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
  application_name: "custodysim-library-upgrade",
  connectionTimeoutMillis: 10_000,
})
const lockKey = "custodysim:20261004:library-schema"
let locked = false

await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expectedDatabase)
    throw new Error("数据库名称不匹配，未做修改")

  await client.query("SET lock_timeout = '5s'")
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
    lockKey,
  ])
  locked = true

  const migrationFiles = [
    "20261004-library.up.sql",
    "20261004-library-reading.up.sql",
    "20261004-library-management.up.sql",
  ]
  for (const filename of migrationFiles) {
    const path = fileURLToPath(
      new URL(`../lib/db/upgrades/${filename}`, import.meta.url),
    )
    const sql = await readFile(path, "utf8")
    try {
      await client.query(sql)
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      throw error
    }
    console.log(`已应用图书馆升级：${filename}`)
  }

  const requiredTables = [
    "library_books",
    "reading_sessions",
    "reading_ticks",
    "reading_progress",
    "library_score_settings",
  ]
  const { rows: missingTables } = await client.query(
    `SELECT name FROM unnest($1::text[]) AS required(name)
     WHERE to_regclass(format('public.%I', name)) IS NULL`,
    [requiredTables],
  )
  if (missingTables.length)
    throw new Error(
      `图书馆表结构校验失败：${missingTables.map((row) => row.name).join(", ")}`,
    )

  const requiredColumns = [
    ["library_books", "reader_text"],
    ["library_books", "cover_bytes"],
    ["library_books", "cover_mime"],
    ["library_books", "cover_updated_at"],
    ["library_books", "deleted_at"],
    ["rules", "reading_minutes"],
    ["report_templates", "reading_minutes"],
  ]
  const { rows: missingColumns } = await client.query(
    `SELECT required.table_name, required.column_name
     FROM unnest($1::text[], $2::text[]) AS required(table_name, column_name)
     LEFT JOIN information_schema.columns actual
       ON actual.table_schema = 'public'
       AND actual.table_name = required.table_name
       AND actual.column_name = required.column_name
     WHERE actual.column_name IS NULL`,
    [
      requiredColumns.map(([table]) => table),
      requiredColumns.map(([, column]) => column),
    ],
  )
  if (missingColumns.length)
    throw new Error(
      `图书馆列结构校验失败：${missingColumns
        .map((row) => `${row.table_name}.${row.column_name}`)
        .join(", ")}`,
    )
  console.log("图书馆表结构校验通过")
} finally {
  if (locked)
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      lockKey,
    ])
  await client.end()
}
