import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import {
  chatConversations,
  chatMessageReads,
  chatMessages,
  users,
} from "@/lib/db/schema"
import { GET } from "@/app/api/chat/conversations/[id]/messages/route"
import {
  inspectPerformanceIndexes,
  performanceIndexes,
  runPerformanceUpgrade,
} from "../../scripts/upgrade-web-performance.mjs"

const actor = vi.hoisted(() => ({ id: "", role: "ADMIN" }))
vi.mock("@/lib/session", () => ({ getSessionUser: async () => actor }))
const userIds = Array.from({ length: 4 }, () => randomUUID())
const conversationId = randomUUID()
const messageIds = Array.from({ length: 52 }, () => randomUUID()).sort()
let seeded = false

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  actor.id = userIds[0]
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values(
        userIds.map((id, index) => ({
          id,
          username: `perf_${id}`,
          name: id,
          passwordHash: "test-only",
          role:
            index === 0 ? "ADMIN" : index === 3 ? "SUPERVISOR" : "SUPERVISED",
        })),
      )
    await tx
      .insert(chatConversations)
      .values({ id: conversationId, type: "DIRECT" })
    const createdAt = new Date()
    await tx
      .insert(chatMessages)
      .values(
        messageIds.map((id) => ({
          id,
          conversationId,
          senderId: userIds[1],
          content: "test",
          createdAt,
        })),
      )
    await tx
      .insert(chatMessageReads)
      .values(
        messageIds.flatMap((messageId) =>
          userIds.slice(1).map((userId) => ({ messageId, userId })),
        ),
      )
  })
  seeded = true
})

afterAll(async () => {
  if (seeded) {
    await db
      .delete(chatConversations)
      .where(eq(chatConversations.id, conversationId))
    await db.delete(users).where(inArray(users.id, userIds))
  }
  await db.$client.end()
})

test("message cursors handle equal timestamps and counts exclude supervisors", async () => {
  const request = (before = "") =>
    new NextRequest(
      `http://localhost/api/chat/conversations/${conversationId}/messages${before ? `?before=${before}` : ""}`,
    )
  const context = { params: Promise.resolve({ id: conversationId }) }
  const first = await (await GET(request(), context)).json()
  expect(first.success).toBe(true)
  expect(first.data).toHaveLength(50)
  expect(
    first.data.map((message: { readCount: number }) => message.readCount),
  ).toEqual(Array(50).fill(2))
  const older = await (await GET(request(first.data[0].id), context)).json()
  expect(older.data).toHaveLength(2)
  expect([...older.data, ...first.data].map((message) => message.id)).toEqual(
    messageIds,
  )
})

test("incremental cursor only returns newer messages in ascending order", async () => {
  const id = randomUUID()
  const a = randomUUID()
  const b = randomUUID()
  const c = randomUUID()
  // d 与 e 用同一个时间戳：验证 (createdAt, id) 的兜底排序，避免"时间相同丢消息"。
  const [d, e] = [randomUUID(), randomUUID()].sort()
  const base = Date.now()
  await db.transaction(async (tx) => {
    await tx.insert(chatConversations).values({ id, type: "DIRECT" })
    await tx.insert(chatMessages).values([
      { id: a, conversationId: id, senderId: userIds[1], content: "a", createdAt: new Date(base) },
      { id: b, conversationId: id, senderId: userIds[1], content: "b", createdAt: new Date(base + 1000) },
      { id: c, conversationId: id, senderId: userIds[1], content: "c", createdAt: new Date(base + 2000) },
      { id: d, conversationId: id, senderId: userIds[1], content: "d", createdAt: new Date(base + 3000) },
      { id: e, conversationId: id, senderId: userIds[1], content: "e", createdAt: new Date(base + 3000) },
    ])
  })
  const context = { params: Promise.resolve({ id }) }
  const request = (query: string) =>
    new NextRequest(
      `http://localhost/api/chat/conversations/${id}/messages${query}`,
    )
  const idsOf = async (query: string) =>
    (await (await GET(request(query), context)).json()).data.map(
      (message: { id: string }) => message.id,
    )
  try {
    // 游标严格排除自身，且正序下发 —— 客户端把游标推进到本页最后一条即可顺序补齐。
    expect(await idsOf(`?after=${a}`)).toEqual([b, c, d, e])
    // 同一时刻按 id 兜底：游标指向 d 时 e 仍要出现在增量里。
    expect(await idsOf(`?after=${d}`)).toEqual([e])
    // 已经是最新一条时返回空数组：稳态轮询的常态，也是这套方案省掉整段历史的前提。
    expect(await idsOf(`?after=${e}`)).toEqual([])
    // 跨会话的游标不报错、也不返回任何消息（边界子查询按会话收敛）。
    expect(await idsOf(`?after=${messageIds[0]}`)).toEqual([])
    // 参数互斥与非法游标。
    const both = await GET(request(`?before=${c}&after=${a}`), context)
    expect(both.status).toBe(400)
    const invalid = await GET(request("?after=not-a-uuid"), context)
    expect(invalid.status).toBe(400)
  } finally {
    await db.delete(chatConversations).where(eq(chatConversations.id, id))
  }
})

test("performance indexes apply idempotently and roll back", async () => {
  const client = await db.$client.connect()
  const before = await inspectPerformanceIndexes(client)
  expect(
    before.every((index) => ["missing", "ready"].includes(index.status)),
  ).toBe(true)
  try {
    expect(
      (await runPerformanceUpgrade(client, "apply")).every(
        (index) => index.status === "ready",
      ),
    ).toBe(true)
    expect(
      (await runPerformanceUpgrade(client, "apply")).every(
        (index) => index.status === "ready",
      ),
    ).toBe(true)
    // Rollback is only exercised when these indexes were not present before
    // this test, so pre-existing test database objects are never removed.
    if (before.every((index) => index.status === "missing")) {
      expect(
        (await runPerformanceUpgrade(client, "rollback")).every(
          (index) => index.status === "missing",
        ),
      ).toBe(true)
    }
  } finally {
    for (const index of performanceIndexes) {
      if (
        before.find((item) => item.name === index.name)?.status === "missing"
      ) {
        await client.query(
          `DROP INDEX CONCURRENTLY IF EXISTS public.${index.name}`,
        )
      }
    }
    client.release()
  }
})
