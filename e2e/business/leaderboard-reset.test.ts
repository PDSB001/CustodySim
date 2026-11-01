import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test } from "vitest"
import { db } from "@/lib/db"
import type { PoolClient } from "pg"
import { resetCurrentLeaderboard } from "../../scripts/reset-current-leaderboard.mjs"

let client: PoolClient
let backupSchema: string | undefined
const first = randomUUID(),
  second = randomUUID(),
  inactive = randomUUID()
const now = new Date("2026-11-01T07:00:00Z")
const options = { day: "2026-11-01", now, expectedDatabase: "custodysim_e2e" }
beforeAll(async () => {
  client = await db.$client.connect()
  expect(
    (await client.query("select current_database() name")).rows[0].name,
  ).toBe("custodysim_e2e")
  // Shadow only this connection's tables; never reset shared E2E accounts.
  for (const table of ["users", "score_events", "audit_logs"])
    await client.query(
      `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`,
    )
  for (const [id, status] of [
    [first, "active"],
    [second, "active"],
    [inactive, "inactive"],
  ])
    await client.query(
      "insert into users(id,username,name,password_hash,role,status) values($1,$3,'test','unused','SUPERVISED',$2)",
      [id, status, `test-${id}`],
    )
  for (const [id, points, week] of [
    [first, -100, "2026-10-26"],
    [second, 7, "2026-10-26"],
    [inactive, -50, "2026-10-26"],
    [first, 9, "2026-10-19"],
  ])
    await client.query(
      "insert into score_events(supervised_id,points,reason,week_key) values($1,$2,'fixture',$3)",
      [id, points, week],
    )
})
afterAll(async () => {
  if (backupSchema) {
    if (!/^custodysim_backup_score_reset_[a-z0-9_]+$/.test(backupSchema))
      throw new Error("Unexpected fixture schema")
    await client.query(`DROP SCHEMA "${backupSchema}" CASCADE`)
  }
  client?.release()
  await db.$client.end()
})
test("只读预览、归零备份和审计，不改历史周或停用账号；重复执行保留新积分", async () => {
  expect(await resetCurrentLeaderboard(client, options)).toMatchObject({
    people: 2,
    beforeTotal: -93,
    changed: false,
  })
  const result = await resetCurrentLeaderboard(client, {
    ...options,
    apply: true,
  })
  backupSchema = result.backupSchema
  expect(result).toMatchObject({
    people: 2,
    adjusted: 2,
    afterTotal: 0,
    changed: true,
  })
  expect(
    (
      await client.query(
        "select count(*)::int n from audit_logs where action='RESET'",
      )
    ).rows[0].n,
  ).toBe(1)
  const rows = (
    await client.query(
      "select supervised_id,week_key,sum(points)::int total from score_events group by supervised_id,week_key",
    )
  ).rows
  expect(rows).toEqual(
    expect.arrayContaining([
      { supervised_id: first, week_key: "2026-10-26", total: 0 },
      { supervised_id: second, week_key: "2026-10-26", total: 0 },
      { supervised_id: inactive, week_key: "2026-10-26", total: -50 },
      { supervised_id: first, week_key: "2026-10-19", total: 9 },
    ]),
  )
  expect(
    (
      await client.query(
        `select sum(points)::int total from "${backupSchema}".score_events`,
      )
    ).rows[0].total,
  ).toBe(-93)
  await client.query(
    "insert into score_events(supervised_id,points,reason,week_key) values($1,2,'new score','2026-10-26')",
    [first],
  )
  expect(
    await resetCurrentLeaderboard(client, { ...options, apply: true }),
  ).toMatchObject({ alreadyApplied: true, changed: false })
  expect(
    (
      await client.query(
        "select sum(points)::int total from score_events where supervised_id=$1 and week_key='2026-10-26'",
        [first],
      )
    ).rows[0].total,
  ).toBe(2)
})
test("拒绝错误日期或未确认目标数据库", async () => {
  await expect(
    resetCurrentLeaderboard(client, { ...options, day: "2026-10-31" }),
  ).rejects.toThrow("current Shanghai")
  await expect(
    resetCurrentLeaderboard(client, {
      ...options,
      apply: true,
      expectedDatabase: "wrong",
    }),
  ).rejects.toThrow("confirmation mismatch")
})
