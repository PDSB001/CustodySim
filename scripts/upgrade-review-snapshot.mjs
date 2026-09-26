import { config } from "dotenv"
import pg from "pg"

/**
 * 批阅快照字段升级：`report_reviews.submitted_snapshot`。
 *
 * 为什么需要它：批阅时要把「当次被审的提交内容」冻结进批阅记录，否则退回→重提会把
 * 上一次答案覆盖掉，历史批阅就还原不出"当时审的是什么"。缺这一列时 `/api/reviews`
 * 与批阅写入都会直接 500，所以必须在上线前补齐。
 *
 * 幂等（`ADD COLUMN IF NOT EXISTS`），重复执行安全：不记录"已应用"，每次只是加列 + 回查校验。
 * 只加列、不动数据 —— 历史批阅此列为 null，读取端会回退到当前提交并标注 snapshotMissing。
 */
config({ path: ".env.local", quiet: true })
const expectedDatabase = process.argv
  .find((arg) => arg.startsWith("--database="))
  ?.slice(11)
if (!expectedDatabase || !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL and --database=<expected database name> are required",
  )
}
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  application_name: "custodysim-review-snapshot-upgrade",
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expectedDatabase)
    throw new Error(
      "Connected database does not match --database; no changes applied",
    )
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query(
      "ALTER TABLE public.report_reviews ADD COLUMN IF NOT EXISTS submitted_snapshot jsonb",
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  const result = await client.query(`
    SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'report_reviews' AND column_name = 'submitted_snapshot'
  `)
  const column = result.rows[0]
  // 类型与可空性都要对上：写入端依赖 jsonb，读取端依赖历史行可以为 null。
  if (column?.data_type !== "jsonb" || column?.is_nullable !== "YES")
    throw new Error("submitted_snapshot column verification failed")
  console.log(`report_reviews.submitted_snapshot ready in ${expectedDatabase}`)
} finally {
  await client.end()
}
