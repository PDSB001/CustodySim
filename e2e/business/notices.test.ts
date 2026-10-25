import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { and, eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

import { db } from "@/lib/db"
import { notices, noticeReads, users } from "@/lib/db/schema"
import { publishGroupedNotice } from "@/lib/notice-events"
import { mergeLegacyNoticeHistory } from "@/lib/notice-history"
import { parseNoticeGroup } from "@/lib/notice-content"
import { GET, PATCH } from "@/app/api/notices/route"
import { GET as adminList } from "@/app/api/admin/notices/route"
import { PATCH as adminPatch } from "@/app/api/admin/notices/[id]/route"
import type { SessionUser } from "@/lib/session"

const session = vi.hoisted(() => ({ actor: null as SessionUser | null }))
vi.mock("@/lib/session", () => ({ getSessionUser: async () => session.actor }))
const noticeIds = new Set<string>()
const accountIds: string[] = []
let reader: SessionUser
let other: SessionUser

async function account(role: SessionUser["role"]) {
  const id = randomUUID()
  accountIds.push(id)
  const name = `e2e_notice_${id}`
  await db
    .insert(users)
    .values({ id, username: name, name, passwordHash: "unused", role })
  return {
    id,
    username: name,
    name,
    role,
    organizationId: null,
    mustChangePassword: false,
  }
}

async function createNotice(targetRole = "ALL", expiresAt: Date | null = null) {
  const [row] = await db
    .insert(notices)
    .values({
      title: `e2e_notice_${randomUUID()}`,
      content: "测试正文",
      targetRole,
      expiresAt,
    })
    .returning()
  noticeIds.add(row!.id)
  return row!
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/notices", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  reader = await account("SUPERVISED")
  other = await account("SUPERVISOR")
  session.actor = reader
})

afterAll(async () => {
  if (noticeIds.size)
    await db.delete(notices).where(inArray(notices.id, [...noticeIds]))
  if (accountIds.length)
    await db.delete(users).where(inArray(users.id, accountIds))
})

test("并发合并只生成一条公示、同一事件重跑不重置已读，新增明细才重新提醒", async () => {
  const period = `e2e-${randomUUID()}`
  const now = new Date("2099-01-05T00:10:00+08:00")
  const entry = (id: string) => ({
    id,
    name: `人员${id}`,
    score: -2,
    startAt: now.toISOString(),
    endAt: new Date(now.getTime() + 86400000).toISOString(),
    status: "ACTIVE" as const,
    occurredAt: now.toISOString(),
  })
  const results = await Promise.all(
    ["a", "b", "c"].map((id) =>
      db.transaction((tx) =>
        publishGroupedNotice(tx, "ISOLATION", period, entry(id), now),
      ),
    ),
  )
  expect(new Set(results).size).toBe(1)
  const id = results[0]!
  noticeIds.add(id)
  const [group] = await db.select().from(notices).where(eq(notices.id, id))
  expect(Object.keys(parseNoticeGroup(group!.metadata)!.entries)).toHaveLength(
    3,
  )
  expect(group!.content).toContain("共 3 人")
  await db.insert(noticeReads).values({ noticeId: id, userId: reader.id })
  await db.transaction((tx) =>
    publishGroupedNotice(tx, "ISOLATION", period, entry("a"), now),
  )
  expect(
    await db.select().from(noticeReads).where(eq(noticeReads.noticeId, id)),
  ).toHaveLength(1)
  await db.transaction((tx) =>
    publishGroupedNotice(
      tx,
      "ISOLATION",
      period,
      entry("d"),
      new Date(now.getTime() + 1000),
    ),
  )
  expect(
    await db.select().from(noticeReads).where(eq(noticeReads.noticeId, id)),
  ).toHaveLength(0)
  session.actor = reader
  expect(
    (
      await PATCH(
        request({
          noticeId: id,
          versions: { [id]: group!.updatedAt.toISOString() },
        }),
      )
    ).status,
  ).toBe(409)
})

test("批量已读验证受众、过期时间及事务原子性；旧单条接口仍可用", async () => {
  const allowed = await createNotice()
  const forbidden = await createNotice("ADMIN")
  const expired = await createNotice("ALL", new Date(Date.now() - 1000))
  session.actor = reader
  expect(
    (await PATCH(request({ noticeIds: [allowed.id, forbidden.id] }))).status,
  ).toBe(404)
  expect(
    await db
      .select()
      .from(noticeReads)
      .where(eq(noticeReads.noticeId, allowed.id)),
  ).toHaveLength(0)
  expect((await PATCH(request({ noticeId: expired.id }))).status).toBe(404)
  expect((await PATCH(request({ noticeId: allowed.id }))).status).toBe(200)
  const second = await createNotice()
  expect(
    (await PATCH(request({ noticeIds: [allowed.id, second.id] }))).status,
  ).toBe(200)
  session.actor = other
  const payload = await (
    await GET(
      new NextRequest(
        `http://localhost/api/notices?unread=1&keyword=${encodeURIComponent(allowed.title)}`,
      ),
    )
  ).json()
  expect(payload.data.items.map((n: { id: string }) => n.id)).toContain(
    allowed.id,
  )
  session.actor = reader
  const own = await (
    await GET(
      new NextRequest(
        `http://localhost/api/notices?unread=1&keyword=${encodeURIComponent(allowed.title)}`,
      ),
    )
  ).json()
  expect(own.data.items).toHaveLength(0)
})

test("历史合并先预览，归档保留原文与已读记录；全读才继承合并已读且重复执行无变化", async () => {
  const time = new Date("2098-07-07T00:10:00+08:00")
  const sources = await db
    .insert(notices)
    .values(
      ["甲", "乙"].map((name) => ({
        title: `禁闭检讨汇报 · ${name}`,
        content: `${name}的完整检讨原文`,
        publishedAt: time,
        createdAt: time,
        createdBy: other.id,
      })),
    )
    .returning()
  sources.forEach((n) => noticeIds.add(n.id))
  await db
    .insert(noticeReads)
    .values([
      ...sources.map((n) => ({ noticeId: n.id, userId: reader.id })),
      { noticeId: sources[0]!.id, userId: other.id },
    ])
  const ids = sources.map((n) => n.id)
  expect(await mergeLegacyNoticeHistory({ noticeIds: ids })).toMatchObject({
    sourceNotices: 2,
    groups: 1,
    applied: false,
  })
  expect(
    (await db.select().from(notices).where(inArray(notices.id, ids))).every(
      (n) => n.published,
    ),
  ).toBe(true)
  await mergeLegacyNoticeHistory({ apply: true, noticeIds: ids })
  const [group] = await db
    .select()
    .from(notices)
    .where(eq(notices.aggregationKey, "ISOLATION_REFLECTION:2098-07-07"))
  noticeIds.add(group!.id)
  expect(group!.content).toContain("甲的完整检讨原文")
  expect(group!.content).toContain("乙的完整检讨原文")
  const original = await db
    .select()
    .from(notices)
    .where(inArray(notices.id, ids))
  expect(original.every((n) => !n.published)).toBe(true)
  expect(original.map((n) => n.content).sort()).toEqual(
    sources.map((n) => n.content).sort(),
  )
  expect(
    await db
      .select()
      .from(noticeReads)
      .where(inArray(noticeReads.noticeId, ids)),
  ).toHaveLength(3)
  expect(
    await db
      .select()
      .from(noticeReads)
      .where(eq(noticeReads.noticeId, group!.id)),
  ).toMatchObject([{ userId: reader.id }])
  expect(
    await mergeLegacyNoticeHistory({ apply: true, noticeIds: ids }),
  ).toMatchObject({ sourceNotices: 0, groups: 0 })
  session.actor = { ...other, role: "ADMIN" }
  expect(
    (
      await adminPatch(request({ published: true }), {
        params: Promise.resolve({ id: sources[0]!.id }),
      })
    ).status,
  ).toBe(404)
  const archived = await (
    await adminList(
      new NextRequest(
        "http://localhost/api/admin/notices?archived=1&keyword=完整检讨原文",
      ),
    )
  ).json()
  expect(archived.data.items.map((n: { id: string }) => n.id).sort()).toEqual(
    ids.sort(),
  )
  expect(
    await db
      .select()
      .from(notices)
      .where(and(eq(notices.id, group!.id), eq(notices.published, true))),
  ).toHaveLength(1)
})

test("历史整理跳过手工普通通知、非全体通知和已过期通知", async () => {
  const rows = await db
    .insert(notices)
    .values([
      { title: "禁闭公示", content: "管理员手工说明", createdBy: other.id },
      {
        title: "禁闭检讨汇报 · 仅监管可见",
        content: "不可公开",
        targetRole: "SUPERVISOR",
      },
      {
        title: "禁闭检讨汇报 · 已过期",
        content: "不应重新发布",
        expiresAt: new Date(Date.now() - 1000),
      },
    ])
    .returning()
  rows.forEach((n) => noticeIds.add(n.id))
  expect(
    await mergeLegacyNoticeHistory({
      apply: true,
      noticeIds: rows.map((n) => n.id),
    }),
  ).toMatchObject({ sourceNotices: 0, groups: 0 })
})
