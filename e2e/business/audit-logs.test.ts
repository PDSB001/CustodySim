import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { auditLogs, users } from "@/lib/db/schema"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { GET } from "@/app/api/audit-logs/route"
import { GET as getDetail } from "@/app/api/audit-logs/[id]/route"
import { runAuditIndexUpgrade } from "../../scripts/upgrade-audit-indexes.mjs"
import { auditSearchText } from "@/lib/audit-search"
import { ilike } from "drizzle-orm"
const session = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: session.token } : undefined,
  }),
}))
const tag = randomUUID(),
  actorIds: string[] = [],
  logIds: string[] = []
async function login(role: "ADMIN" | "SUPERVISOR" | "SUPERVISED") {
  const id = randomUUID()
  actorIds.push(id)
  await db.insert(users).values({
    id,
    username: `audit_${id}`,
    name: "audit test",
    passwordHash: "unused",
    role,
    mustChangePassword: false,
  })
  session.token = await signToken({ userId: id, tokenVersion: 0, role })
}
const request = (params: Record<string, string> = {}) =>
  new NextRequest(
    `http://localhost/api/audit-logs?${new URLSearchParams({ q: tag, ...params })}`,
  )
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  const migrationClient = await db.$client.connect()
  try {
    expect(
      (await runAuditIndexUpgrade(migrationClient, "apply")).every(
        (index: { status: string }) => index.status === "ready",
      ),
    ).toBe(true)
    expect(
      (await runAuditIndexUpgrade(migrationClient, "apply")).every(
        (index: { status: string }) => index.status === "ready",
      ),
    ).toBe(true)
  } finally {
    migrationClient.release()
  }
  await login("ADMIN")
  for (const [index, actorType] of ["USER", "SYSTEM_AI", "SYSTEM"].entries()) {
    const id = randomUUID()
    logIds.push(id)
    await db.insert(auditLogs).values({
      id,
      actorId: actorIds[0],
      actorName: `literal_%_${tag}`,
      actorRole: actorType === "USER" ? "ADMIN" : actorType,
      actorType,
      action: index === 1 ? "REPAIR" : "UPDATE",
      actionLabel: `审计回归${tag}`,
      entityType: `audit_${tag}`,
      entityId: randomUUID(),
      detail: {
        before: { points: -144 },
        after: { points: -96 },
        passwordHash: "fixture-secret",
      },
    })
    await db.execute(
      sql`update ${auditLogs} set created_at = ${`2026-11-01T00:00:00.12345${6 - index}Z`}::timestamptz where id=${id}`,
    )
  }
})

test("审计游标和元数据搜索均有可用索引", async () => {
  await db.transaction(async (tx) => {
    // Check index eligibility, not the cost-based choice for a tiny fixture.
    await tx.execute(sql`set local enable_seqscan = off`)
    await tx.execute(sql`set local enable_bitmapscan = off`)
    await tx.execute(sql`set local enable_sort = off`)
    await tx.execute(sql`set local enable_incremental_sort = off`)
    const cursorPlan = await tx.execute(
      sql`explain select id, created_at from ${auditLogs} where (created_at,id) < ('2026-11-02'::timestamptz, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid) order by created_at desc,id desc limit 51`,
    )
    expect(JSON.stringify(cursorPlan.rows)).toContain(
      "audit_logs_created_id_idx",
    )
    expect(JSON.stringify(cursorPlan.rows)).not.toContain("Sort Key")
    await tx.execute(sql`set local enable_bitmapscan = on`)
    const searchPlan = await tx.execute(
      sql`explain select id from ${auditLogs} where ${ilike(auditSearchText(auditLogs), `%${tag}%`)}`,
    )
    expect(JSON.stringify(searchPlan.rows)).toContain(
      "audit_logs_search_trgm_idx",
    )
  })
})
afterAll(async () => {
  if (logIds.length)
    await db.delete(auditLogs).where(inArray(auditLogs.id, logIds))
  if (actorIds.length) await db.delete(users).where(inArray(users.id, actorIds))
  await db.$client.end()
})
test("服务端组合筛选及字面通配符搜索，不在列表加载详情", async () => {
  const response = await GET(
    request({
      actorType: "SYSTEM_AI",
      action: "REPAIR",
      entityType: `audit_${tag}`,
      from: "2026-11-01",
      to: "2026-11-01",
    }),
  )
  expect(response.status).toBe(200)
  const { data } = await response.json()
  expect(data.items).toHaveLength(1)
  expect(data.items[0].id).toBe(logIds[1])
  expect(data.items[0]).not.toHaveProperty("detail")
  expect(
    (await (await GET(request({ q: `literal_%_${tag}` }))).json()).data.items,
  ).toHaveLength(3)
  expect(
    (
      await (
        await GET(request({ from: "2026-10-31", to: "2026-10-31" }))
      ).json()
    ).data.items,
  ).toHaveLength(0)
})
test("微秒游标连续分页不丢行，非法游标和日期返回 400", async () => {
  const seen: string[] = []
  let cursor = ""
  for (let i = 0; i < 3; i++) {
    const { data } = await (
      await GET(request({ limit: "1", ...(cursor ? { cursor } : {}) }))
    ).json()
    seen.push(data.items[0].id)
    cursor = data.nextCursor ?? ""
  }
  expect(seen).toEqual(logIds)
  expect(cursor).toBe("")
  expect((await GET(request({ cursor: "bad" }))).status).toBe(400)
  expect((await GET(request({ from: "2026-99-01" }))).status).toBe(400)
})
test("详情可追溯前后值并屏蔽凭据，非法或不存在记录分别返回 400/404", async () => {
  const response = await getDetail(new Request("http://localhost"), {
    params: Promise.resolve({ id: logIds[1]! }),
  })
  const { data } = await response.json()
  expect(data.detail.before.points).toBe(-144)
  expect(data.detail.after.points).toBe(-96)
  expect(data.detail.passwordHash).not.toBe("fixture-secret")
  expect(
    (
      await getDetail(new Request("http://localhost"), {
        params: Promise.resolve({ id: "bad" }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await getDetail(new Request("http://localhost"), {
        params: Promise.resolve({ id: randomUUID() }),
      })
    ).status,
  ).toBe(404)
})
test("匿名、监管员和普通用户均不能访问列表或详情", async () => {
  for (const role of [null, "SUPERVISOR", "SUPERVISED"] as const) {
    if (role) await login(role)
    else session.token = ""
    expect((await GET(request())).status).toBe(403)
    expect(
      (
        await getDetail(new Request("http://localhost"), {
          params: Promise.resolve({ id: logIds[0]! }),
        })
      ).status,
    ).toBe(403)
  }
})
