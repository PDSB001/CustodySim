import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { libraryScoreSettings } from "@/lib/db/schema"
import { getReadingScorePolicy } from "@/lib/reading-server"
import { GET as getLibrary } from "@/app/api/library/route"
import { GET as getSettings } from "@/app/api/admin/library/settings/route"
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    role: "ADMIN",
    mustChangePassword: false,
  }),
}))

let original: typeof libraryScoreSettings.$inferSelect | undefined
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  ;[original] = await db
    .select()
    .from(libraryScoreSettings)
    .where(eq(libraryScoreSettings.id, 1))
})
afterAll(async () => {
  await db.delete(libraryScoreSettings).where(eq(libraryScoreSettings.id, 1))
  if (original) await db.insert(libraryScoreSettings).values(original)
  await db.$client.end()
})
test("无配置行时图书馆公示、管理页面及结算策略都为每天两分", async () => {
  await db.delete(libraryScoreSettings).where(eq(libraryScoreSettings.id, 1))
  const settlement = await getReadingScorePolicy()
  expect(settlement.dailyCap).toBe(2)
  const library = await getLibrary()
  expect(library.status).toBe(200)
  expect((await library.json()).data.scorePolicy).toEqual(settlement)
  expect((await (await getSettings()).json()).data).toEqual(settlement)
})
test("升级仅统一数据库默认值，保留管理员已保存的三分配置", async () => {
  await db.insert(libraryScoreSettings).values({ id: 1, dailyCap: 3 })
  const migration = await readFile(
    new URL(
      "../../lib/db/upgrades/20261101-library-policy.up.sql",
      import.meta.url,
    ),
    "utf8",
  )
  const client = await db.$client.connect()
  try {
    await client.query(migration)
    await client.query(migration)
  } finally {
    client.release()
  }
  expect((await getReadingScorePolicy()).dailyCap).toBe(3)
  const result = await db.execute(
    sql`select column_default from information_schema.columns where table_schema='public' and table_name='library_score_settings' and column_name='daily_cap'`,
  )
  expect(result.rows[0]?.column_default).toBe("2")
})
