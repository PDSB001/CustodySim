import { config } from "dotenv"
import pg from "pg"

config({ path: ".env.local", quiet: true })
const expected = process.argv
  .find((arg) => arg.startsWith("--database="))
  ?.slice(11)
if (!expected || !process.env.DATABASE_URL)
  throw new Error("需要 DATABASE_URL 和 --database=<目标数据库名>")
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expected) throw new Error("数据库名称不匹配，未做修改")
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query(
      "ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS aggregation_key varchar(160), ADD COLUMN IF NOT EXISTS metadata jsonb",
    )
    await client.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS notices_aggregation_key_unique ON public.notices (aggregation_key)",
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  console.log(`通知聚合字段已就绪：${expected}`)
} finally {
  await client.end()
}
