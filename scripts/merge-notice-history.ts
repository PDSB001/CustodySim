import { config } from "dotenv"

async function main() {
  config({ path: ".env.local", quiet: true })
  const expected = process.argv
    .find((arg) => arg.startsWith("--database="))
    ?.slice(11)
  if (!expected || !process.env.DATABASE_URL)
    throw new Error(
      "需要 DATABASE_URL 和 --database=<目标数据库名>；默认只预览，--apply 执行归档",
    )
  const { db } = await import("@/lib/db")
  const { sql } = await import("drizzle-orm")
  const result = await db.execute(sql`select current_database() as name`)
  if (result.rows[0]?.name !== expected)
    throw new Error("数据库名称不匹配，未做修改")
  const { mergeLegacyNoticeHistory } = await import("@/lib/notice-history")
  console.log(
    JSON.stringify(
      await mergeLegacyNoticeHistory({
        apply: process.argv.includes("--apply"),
      }),
    ),
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
