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
