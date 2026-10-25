import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test } from "vitest"
import { eq, sql } from "drizzle-orm"
import pg from "pg"
import { db } from "@/lib/db"
import {
  checkinTasks,
  notices,
  persons,
  pushDeliveries,
  reportTasks,
  rules,
  users,
} from "@/lib/db/schema"
import {
  enqueueCheckinReminders,
  enqueueNoticeNotifications,
  enqueueTaskNotifications,
  registerPushDevice,
} from "@/lib/push-server"
import { startPushWorker, providerPayload } from "../../scripts/push-worker.mjs"

const userId = randomUUID(),
  ruleId = randomUUID(),
  noticeId = randomUUID()
const credentials = {
  installationId: randomUUID(),
  secret: "ef".repeat(32),
  enabled: true,
}
let device: { id: string; bindingId: string }
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  await db.insert(users).values({
    id: userId,
    username: `reminder_${userId}`,
    name: "提醒测试",
    passwordHash: "unused",
    role: "SUPERVISED",
  })
  await db
    .insert(persons)
    .values({ userId, name: "提醒测试", custodyStatus: "IN_CUSTODY" })
  await db
    .insert(rules)
    .values({ id: ruleId, name: "打卡提醒测试", type: "CHECKIN" })
  await db.insert(notices).values({
    id: noticeId,
    title: "测试通知",
    content: "正文不进入推送载荷",
    published: true,
    targetRole: "ALL",
  })
  device = (await registerPushDevice(userId, credentials))!
})
afterAll(async () => {
  await db.delete(reportTasks).where(eq(reportTasks.supervisedId, userId))
  await db.delete(rules).where(eq(rules.id, ruleId))
  await db.delete(notices).where(eq(notices.id, noticeId))
  await db.delete(users).where(eq(users.id, userId))
})

test("notice preference prevents enqueue and cancels already queued delivery", async () => {
  await registerPushDevice(userId, { ...credentials, noticesEnabled: false })
  await db.transaction((tx) => enqueueNoticeNotifications(tx, noticeId))
  expect(
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.userId, userId)),
  ).toHaveLength(0)
  await registerPushDevice(userId, { ...credentials, noticesEnabled: true })
  await db.transaction((tx) => enqueueNoticeNotifications(tx, noticeId))
  await registerPushDevice(userId, { ...credentials, noticesEnabled: false })
  await runWorker()
  const rows = await db
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.userId, userId))
  expect(rows).toHaveLength(1)
  expect(rows[0]!.state).toBe("SKIPPED")
})

test("check-in reminders require opt-in, deduplicate stages and recheck completion and expiry", async () => {
  const now = new Date()
  const create = async (
    minutesAgo: number,
    remaining: number,
    status = "PENDING",
  ) =>
    (
      await db
        .insert(checkinTasks)
        .values({
          ruleId,
          supervisedId: userId,
          slotIndex: 0,
          status,
          scheduleAt: new Date(now.getTime() - minutesAgo * 60_000),
          deadline: new Date(now.getTime() + remaining * 60_000),
        })
        .returning()
    )[0]!
  const open = await create(1, 59),
    closing = await create(51, 9)
  const short = await create(12, 8),
    future = await create(-20, 40),
    expired = await create(60, -1)
  const finished = await create(2, 58, "NORMAL")
  await enqueueCheckinReminders([open], now)
  expect(
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.entityId, open.id)),
  ).toHaveLength(0)
  await registerPushDevice(userId, {
    ...credentials,
    checkinRemindersEnabled: true,
  })
  for (let i = 0; i < 2; i++)
    await enqueueCheckinReminders(
      [open, closing, short, future, expired, finished],
      now,
    )
  const queued = await db
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.kind, "CHECKIN"))
  expect(
    queued
      .filter((row) => row.userId === userId)
      .map((row) => row.entityId)
      .sort(),
    // open 还在早期 → OPEN；closing 已进入最后 12 分钟（60 分钟窗口的 20%）→ CLOSING；
    // short（20 分钟窗口）剩余 8 分钟，尚未进入 5 分钟截止带 → OPEN。
  ).toEqual([open.id, closing.id, short.id].sort())
  await db
    .update(checkinTasks)
    .set({ status: "NORMAL" })
    .where(eq(checkinTasks.id, open.id))
  await db
    .update(checkinTasks)
    .set({ deadline: new Date(Date.now() - 1000) })
    .where(eq(checkinTasks.id, closing.id))
  await runWorker()
  for (const task of [open, closing])
    expect(
      (
        await db
          .select()
          .from(pushDeliveries)
          .where(eq(pushDeliveries.entityId, task.id))
      )[0]!.state,
    ).toBe("SKIPPED")

  const active = await create(3, 57)
  await enqueueCheckinReminders([active], now)
  const payloads = await runWorker()
  expect(payloads).toHaveLength(1)
  expect(payloads[0]!.kind).toBe("CHECKIN")
  expect(payloads[0]!.expiresAt).toBe(active.deadline.toISOString())
  const provider = providerPayload(payloads[0], "test-token", "test-key")
  expect(provider.payload.body.title).toBe("打卡提醒")
  expect(JSON.stringify(provider)).not.toContain("正文不进入推送载荷")
})

test("task events cover new, closing and review results; submitted, expired and stale results are skipped", async () => {
  const now = new Date()
  const create = async (status: string, age = 0, minutesLeft = 120) =>
    (
      await db
        .insert(reportTasks)
        .values({
          title: "私有任务标题",
          supervisedId: userId,
          status,
          scheduleAt: new Date(now.getTime() - age * 60_000),
          createdAt: new Date(now.getTime() - age * 60_000),
          deadline: new Date(now.getTime() + minutesLeft * 60_000),
        })
        .returning()
    )[0]!
  const open = await create("PENDING"),
    closing = await create("PENDING", 120, 25)
  const returned = await create("RETURNED"),
    approved = await create("APPROVED")
  await create("SUBMITTED")
  await create("PENDING", 120, -1)
  await create("PENDING", -10)
  await registerPushDevice(userId, { ...credentials, tasksEnabled: false })
  await enqueueTaskNotifications(now)
  expect(
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.kind, "TASK")),
  ).toHaveLength(0)
  await registerPushDevice(userId, { ...credentials, tasksEnabled: true })
  await enqueueTaskNotifications(now)
  await enqueueTaskNotifications(now)
  const queued = (
    await db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.userId, userId))
  ).filter((row) => row.kind === "TASK")
  expect(queued.map((row) => row.entityId).sort()).toEqual(
    [open.id, closing.id, returned.id, approved.id].sort(),
  )
  await db
    .update(reportTasks)
    .set({ status: "SUBMITTED" })
    .where(eq(reportTasks.id, open.id))
  await db
    .update(reportTasks)
    .set({ status: "APPROVED", updatedAt: new Date(now.getTime() + 1000) })
    .where(eq(reportTasks.id, returned.id))
  const delivered = await runWorker()
  expect(delivered.map((payload) => payload.taskEvent).sort()).toEqual([
    "APPROVED",
    "CLOSING",
  ])
  expect(JSON.stringify(delivered)).not.toContain("私有任务标题")
  expect(
    providerPayload(delivered[0], "test-token", "test-key").payload.body.title,
  ).toBe("任务提醒")
})

async function runWorker() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const delivered: Record<string, string>[] = []
  const room = `device:${device.id}:${device.bindingId}`
  const worker = startPushWorker(
    pool,
    {
      sockets: { adapter: { rooms: new Map([[room, new Set(["native"])]]) } },
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
    { intervalMs: 30 },
  )
  try {
    worker.wake()
    await expect
      .poll(
        async () =>
          (
            await db.execute(
              sql`select count(*)::int as count from push_deliveries where user_id=${userId} and state in ('PENDING','PROCESSING')`,
            )
          ).rows[0]?.count,
        { timeout: 5000 },
      )
      .toBe(0)
    return delivered
  } finally {
    await worker.stop()
    await pool.end()
  }
}
