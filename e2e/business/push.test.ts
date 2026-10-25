import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import pg from "pg"
import { db } from "@/lib/db"
import { getSessionUser } from "@/lib/session"
import { POST as updateChatNotifications } from "@/app/api/chat/conversations/[id]/notifications/route"
import {
  users,
  pushDeliveries,
  chatConversations,
  chatConversationMembers,
  chatMessages,
  chatMessageReads,
  chatNotificationPreferences,
} from "@/lib/db/schema"
import {
  registerPushDevice,
  enqueueChatNotifications,
  deviceRealtimeToken,
} from "@/lib/push-server"
// Runtime worker deliberately shares no Next.js-only imports.
import {
  startPushWorker,
  sendUmeng,
  providerPayload,
} from "../../scripts/push-worker.mjs"

const ids = [randomUUID(), randomUUID()]
vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }))
const conversationId = randomUUID()
const secret = "ab".repeat(32)
const installationId = randomUUID()
let device: { id: string; bindingId: string }
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  await db.insert(users).values(
    ids.map((id, i) => ({
      id,
      username: `e2e_push_${id}`,
      name: i ? "收件人" : "发送者",
      passwordHash: "unused",
      role: "SUPERVISED",
    })),
  )
  await db
    .insert(chatConversations)
    .values({ id: conversationId, type: "DIRECT" })
  await db
    .insert(chatConversationMembers)
    .values(ids.map((userId) => ({ userId, conversationId })))
  device = (await registerPushDevice(ids[1]!, {
    installationId,
    secret,
    enabled: true,
  }))!
})
afterAll(async () => {
  await db
    .delete(chatConversations)
    .where(eq(chatConversations.id, conversationId))
  await db.delete(users).where(inArray(users.id, ids))
})

test("installation ownership and account rebinding invalidate old notification credentials", async () => {
  expect(
    await registerPushDevice(ids[0]!, {
      installationId,
      secret: "cd".repeat(32),
      enabled: true,
    }),
  ).toBeNull()
  expect(await deviceRealtimeToken(ids[0]!, device.id, secret)).toBeNull()
  expect(await deviceRealtimeToken(ids[1]!, device.id, secret)).toBeTypeOf(
    "string",
  )
  const rebound = await registerPushDevice(ids[0]!, {
    installationId,
    secret,
    enabled: true,
  })
  expect(rebound!.bindingId).not.toBe(device.bindingId)
  expect(await deviceRealtimeToken(ids[1]!, device.id, secret)).toBeNull()
  device = (await registerPushDevice(ids[1]!, {
    installationId,
    secret,
    enabled: true,
  }))!
})

async function message() {
  const id = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({
      id,
      conversationId,
      senderId: ids[0],
      content: "机密正文不会发送给友盟",
    })
    await enqueueChatNotifications(tx, id, conversationId, ids[0]!)
    await enqueueChatNotifications(tx, id, conversationId, ids[0]!)
  })
  const rows = await db
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.entityId, id))
  expect(rows).toHaveLength(1)
  return rows[0]!
}

test("online ACK uses direct delivery; read, recalled, stale-binding messages are skipped", async () => {
  const sent = await message(),
    read = await message(),
    recalled = await message(),
    stale = await message()
  await db
    .insert(chatMessageReads)
    .values({ messageId: read.entityId, userId: ids[1]! })
  await db
    .update(chatMessages)
    .set({ recalledAt: new Date() })
    .where(eq(chatMessages.id, recalled.entityId))
  await db
    .update(pushDeliveries)
    .set({ bindingId: randomUUID() })
    .where(eq(pushDeliveries.id, stale.id))
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const delivered: Record<string, string>[] = []
  const worker = startPushWorker(
    pool,
    {
      sockets: {
        adapter: {
          rooms: new Map([
            [`device:${device.id}:${device.bindingId}`, new Set(["native"])],
          ]),
        },
      },
      to: () => ({
        timeout: () => ({
          emitWithAck: async (
            _name: string,
            payload: Record<string, string>,
          ) => {
            delivered.push(payload)
            return [{ ok: true }]
          },
        }),
      }),
    },
    { intervalMs: 50 },
  )
  try {
    worker.wake()
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(pushDeliveries)
              .where(eq(pushDeliveries.id, stale.id))
          )[0]?.state,
        { timeout: 5000 },
      )
      .toBe("SKIPPED")
    expect(
      (
        await db
          .select()
          .from(pushDeliveries)
          .where(eq(pushDeliveries.id, sent.id))
      )[0]?.state,
    ).toBe("DIRECT")
    expect(delivered).toHaveLength(1)
    expect(JSON.stringify(delivered)).not.toContain("机密正文")
    expect(delivered[0]?.senderName).toBe("发送者")
  } finally {
    await worker.stop()
    await pool.end()
  }
})

test("missing native ACK falls back to provider without exposing message content", async () => {
  const token = "fake_provider_token_" + "x".repeat(32)
  device = (await registerPushDevice(ids[1]!, {
    installationId,
    secret,
    providerToken: token,
    enabled: true,
  }))!
  const pending = await message()
  const calls: string[] = []
  vi.stubEnv("UMENG_PUSH_ENABLED", "true")
  vi.stubEnv("UMENG_APP_KEY", "test")
  vi.stubEnv("UMENG_APP_MASTER_SECRET", "test")
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    calls.push(String(init.body))
    return Response.json({ ret: "SUCCESS" })
  })
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const room = "device:" + device.id + ":" + device.bindingId
  const worker = startPushWorker(
    pool,
    {
      sockets: { adapter: { rooms: new Map([[room, new Set(["native"])]]) } },
      to: () => ({
        timeout: () => ({
          emitWithAck: async () => {
            throw Error("ack timeout")
          },
        }),
      }),
    },
    { intervalMs: 50 },
  )
  try {
    worker.wake()
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(pushDeliveries)
              .where(eq(pushDeliveries.id, pending.id))
          )[0]?.state,
        { timeout: 5000 },
      )
      .toBe("PUSH")
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain("机密正文")
    expect(JSON.parse(calls[0]!).payload.body.text).toBe("发来一条消息")
  } finally {
    await worker.stop()
    await pool.end()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

test("provider payload is generic and signed; disabled provider cannot send", async () => {
  const delivery = {
    deliveryId: randomUUID(),
    kind: "CHAT",
    senderName: "甲",
    entityId: randomUUID(),
  }
  const body = providerPayload(delivery, "fake-token", "fake-key")
  expect(body.payload.body.text).toBe("发来一条消息")
  expect(body.payload.body.title).toBe("甲")
  const requests: string[] = []
  await sendUmeng(
    delivery,
    "fake-token",
    {
      NODE_ENV: "test",
      UMENG_PUSH_ENABLED: "true",
      UMENG_APP_KEY: "test",
      UMENG_APP_MASTER_SECRET: "test",
    },
    async (url) => {
      requests.push(String(url))
      return Response.json({ ret: "SUCCESS" })
    },
  )
  expect(requests[0]).toMatch(
    /^https:\/\/msgapi.umeng.com\/api\/send\?sign=[0-9a-f]{32}$/,
  )
  await expect(
    sendUmeng(
      delivery,
      "fake-token",
      { NODE_ENV: "test", UMENG_PUSH_ENABLED: "false" },
      () => {
        throw Error("must not send")
      },
    ),
  ).rejects.toThrow("PROVIDER_DISABLED")
})

test("chat DND blocks enqueue and skips messages already queued before muting", async () => {
  const pending = await message()
  await db
    .insert(chatNotificationPreferences)
    .values({ userId: ids[1]!, conversationId, muted: true })
  const mutedMessage = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({
      id: mutedMessage,
      conversationId,
      senderId: ids[0],
      content: "静音消息",
    })
    await enqueueChatNotifications(tx, mutedMessage, conversationId, ids[0]!)
  })
  expect(
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.entityId, mutedMessage)),
  ).toHaveLength(0)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const worker = startPushWorker(
    pool,
    { sockets: { adapter: { rooms: new Map() } } },
    { intervalMs: 30 },
  )
  try {
    worker.wake()
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(pushDeliveries)
              .where(eq(pushDeliveries.id, pending.id))
          )[0]?.state,
        { timeout: 5000 },
      )
      .toBe("SKIPPED")
  } finally {
    await worker.stop()
    await pool.end()
  }
  await db
    .delete(chatNotificationPreferences)
    .where(eq(chatNotificationPreferences.userId, ids[1]!))
  await registerPushDevice(ids[1]!, {
    installationId,
    secret,
    enabled: true,
    chatEnabled: false,
  })
  await db.transaction((tx) =>
    enqueueChatNotifications(tx, mutedMessage, conversationId, ids[0]!),
  )
  expect(
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.entityId, mutedMessage)),
  ).toHaveLength(0)
  await registerPushDevice(ids[1]!, {
    installationId,
    secret,
    enabled: true,
    chatEnabled: true,
  })
  await db.transaction((tx) =>
    enqueueChatNotifications(tx, mutedMessage, conversationId, ids[0]!),
  )
  expect(
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.entityId, mutedMessage)),
  ).toHaveLength(1)
})

test("conversation notification preferences require access and only update the signed-in user's setting", async () => {
  const call = (id: string, body: object) =>
    updateChatNotifications(
      new Request("http://localhost/api/chat/conversations/notifications", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id }) },
    )
  vi.mocked(getSessionUser).mockResolvedValue(null)
  expect((await call(conversationId, { muted: true })).status).toBe(401)
  vi.mocked(getSessionUser).mockResolvedValue({
    id: ids[1]!,
    username: "recipient",
    name: "收件人",
    role: "SUPERVISED",
    organizationId: null,
    mustChangePassword: false,
  })
  expect((await call(randomUUID(), { muted: true })).status).toBe(404)
  const foreignConversation = randomUUID()
  await db
    .insert(chatConversations)
    .values({ id: foreignConversation, type: "DIRECT" })
  try {
    expect((await call(foreignConversation, { muted: true })).status).toBe(404)
  } finally {
    await db
      .delete(chatConversations)
      .where(eq(chatConversations.id, foreignConversation))
  }
  expect((await call(conversationId, { muted: "yes" })).status).toBe(400)
  expect(
    (await call(conversationId, { muted: true, userId: ids[0] })).status,
  ).toBe(200)
  const stored = await db
    .select()
    .from(chatNotificationPreferences)
    .where(eq(chatNotificationPreferences.conversationId, conversationId))
  expect(stored).toHaveLength(1)
  expect(stored[0]!.userId).toBe(ids[1])
  expect(stored[0]!.muted).toBe(true)
})
