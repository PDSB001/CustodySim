import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { and, eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { POST as submit } from "@/app/api/submissions/route"
import { POST as saveDraft } from "@/app/api/submissions/draft/route"
import { POST as review } from "@/app/api/reviews/route"
import { POST as adjustScore } from "@/app/api/scores/route"
import * as audit from "@/lib/audit"
import { runReportTaskOutcomeSweep } from "@/lib/task-engine"
import {
  reconcileTaskOutcomeScoreWeeks,
  runWeeklyScoreReview,
  ensureIsolationReflectionTask,
  recordScoreEvent,
} from "@/lib/scoring"

// Only Next's request cookie adapter and wall clock are supplied by the harness.
// JWT verification, authorization, route handlers, transactions and sweeps are real.
const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
}))
const monday = new Date("2026-08-31T00:10:00+08:00")
const sunday = new Date("2026-08-30T23:30:00+08:00")
const ids: string[] = []
let admin: string
let user: string

async function account(role: "ADMIN" | "SUPERVISED" | "SUPERVISOR") {
  const id = randomUUID()
  ids.push(id)
  await db.insert(s.users).values({
    id,
    username: `e2e_${id}`,
    name: `e2e_${id}`,
    passwordHash: "unused",
    role,
    mustChangePassword: false,
  })
  if (role === "SUPERVISED")
    await db
      .insert(s.persons)
      .values({ userId: id, name: id, custodyStatus: "IN_CUSTODY" })
  return id
}
async function as(id: string, role: "ADMIN" | "SUPERVISED" | "SUPERVISOR") {
  cookie.token = await signToken({ userId: id, role, tokenVersion: 0 })
}
function request(data: unknown) {
  return new NextRequest("http://localhost/api/e2e", {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "content-type": "application/json" },
  })
}
async function task(
  status = "PENDING",
  deadline = new Date("2026-08-31T23:59:00+08:00"),
) {
  const [row] = await db
    .insert(s.reportTasks)
    .values({
      supervisedId: user,
      title: "周日晚任务",
      scheduleAt: sunday,
      deadline,
      status,
      templateSnapshot: { fields: [] },
    })
    .returning()
  return row!
}
async function events() {
  return db
    .select()
    .from(s.scoreEvents)
    .where(eq(s.scoreEvents.supervisedId, user))
}
async function reviews() {
  return db
    .select()
    .from(s.scoreWeekReviews)
    .where(eq(s.scoreWeekReviews.supervisedId, user))
}

beforeAll(async () => {
  const result = await db.execute(sql`select current_database() as name`)
  expect(result.rows[0]?.name).toBe("custodysim_e2e")
  admin = await account("ADMIN")
})
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(monday)
  user = await account("SUPERVISED")
})
afterAll(async () => {
  vi.useRealTimers()
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    await db
      .delete(s.isolationOrders)
      .where(inArray(s.isolationOrders.supervisedId, ids))
    await db
      .delete(s.reportTasks)
      .where(inArray(s.reportTasks.supervisedId, ids))
    await db
      .delete(s.checkinTasks)
      .where(inArray(s.checkinTasks.supervisedId, ids))
    await db
      .delete(s.checkinDailyScores)
      .where(inArray(s.checkinDailyScores.supervisedId, ids))
    await db
      .delete(s.scoreEvents)
      .where(inArray(s.scoreEvents.supervisedId, ids))
    await db
      .delete(s.scoreWeekReviews)
      .where(inArray(s.scoreWeekReviews.supervisedId, ids))
    await db.delete(s.persons).where(inArray(s.persons.userId, ids))
    await db.delete(s.notices).where(inArray(s.notices.createdBy, ids))
    for (const id of ids)
      await db
        .delete(s.notices)
        .where(sql`${s.notices.content} like ${`%e2e_${id}%`}`)
    await db.delete(s.users).where(inArray(s.users.id, ids))
  }
  await db.$client.end()
})

test.each([false, true])(
  "周日晚任务周一提交审核（曾退回=%s），只记一次并归属上周",
  async (returned) => {
    const row = await task()
    await as(user, "SUPERVISED")
    const response = await submit(request({ taskId: row.id, data: {} }))
    expect(response.status).toBe(201)
    const submissionId = (await response.json()).data.id
    if (returned) {
      await as(admin, "ADMIN")
      expect(
        (await review(request({ submissionId, result: "RETURNED" }))).status,
      ).toBe(201)
      expect(await events()).toHaveLength(0)
      await as(user, "SUPERVISED")
      expect((await submit(request({ taskId: row.id, data: {} }))).status).toBe(
        201,
      )
    }
    await as(admin, "ADMIN")
    expect(
      (await review(request({ submissionId, result: "APPROVED" }))).status,
    ).toBe(201)
    expect(
      (await review(request({ submissionId, result: "APPROVED" }))).status,
    ).toBe(409)
    expect(await events()).toMatchObject([
      { points: returned ? 1 : 2, weekKey: "2026-08-24", sourceId: row.id },
    ])
    expect(await events()).toHaveLength(1)
  },
)

test("周日晚任务周一过期与缺失流水回填保持幂等", async () => {
  const expired = await task("PENDING", new Date("2026-08-31T00:01:00+08:00"))
  await task("EXPIRED", new Date("2026-08-31T00:01:00+08:00"))
  await runReportTaskOutcomeSweep(monday)
  await runReportTaskOutcomeSweep(monday)
  expect(await events()).toHaveLength(2)
  expect(
    (await events()).every(
      (e) => e.weekKey === "2026-08-24" && e.points === -2,
    ),
  ).toBe(true)
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, expired.id)),
  ).toMatchObject([{ status: "EXPIRED" }])
})

test("周结在 00:10 前不落库，边界时先补日结且重复执行不重复禁闭", async () => {
  const [rule] = await db
    .insert(s.rules)
    .values({ name: `e2e_${user}` })
    .returning()
  try {
    await db.insert(s.checkinTasks).values({
      ruleId: rule!.id,
      supervisedId: user,
      slotIndex: 0,
      scheduleAt: sunday,
      deadline: sunday,
      status: "COMPLETED",
    })
    await recordScoreEvent({
      supervisedId: user,
      points: -2,
      reason: "fixture",
      source: "MANUAL",
      weekKey: "2026-08-24",
    })
    await runWeeklyScoreReview(new Date("2026-08-31T00:09:59.999+08:00"))
    expect(await reviews()).toHaveLength(0)
    expect(
      await db
        .select()
        .from(s.checkinDailyScores)
        .where(eq(s.checkinDailyScores.supervisedId, user)),
    ).toHaveLength(0)
    await runWeeklyScoreReview(monday)
    await runWeeklyScoreReview(monday)
    expect(await reviews()).toMatchObject([{ totalScore: 3, result: "CLEAR" }])
    expect(await reviews()).toHaveLength(1)
    expect(
      await db
        .select()
        .from(s.isolationOrders)
        .where(eq(s.isolationOrders.supervisedId, user)),
    ).toHaveLength(0)
    expect(await events()).toHaveLength(2)
  } finally {
    await db.delete(s.rules).where(eq(s.rules.id, rule!.id))
  }
})

test("跨周校正同时重算两周、撤销错误禁闭并取消未完成反思，重跑无副作用", async () => {
  const row = await task("EXPIRED")
  await recordScoreEvent({
    supervisedId: user,
    points: -2,
    reason: "legacy",
    source: "TASK_OUTCOME",
    sourceId: row.id,
    weekKey: "2026-08-31",
  })
  await db.insert(s.scoreWeekReviews).values([
    {
      supervisedId: user,
      weekKey: "2026-08-24",
      totalScore: 0,
      result: "CLEAR",
    },
    {
      supervisedId: user,
      weekKey: "2026-08-31",
      totalScore: -2,
      result: "ISOLATION",
    },
  ])
  const [order] = await db
    .insert(s.isolationOrders)
    .values({
      supervisedId: user,
      weekKey: "2026-08-31",
      triggerScore: -2,
      previousCustodyStatus: "IN_CUSTODY",
      startAt: monday,
      endAt: new Date("2026-09-03T00:00:00+08:00"),
    })
    .returning()
  await db
    .update(s.persons)
    .set({ custodyStatus: "ISOLATION" })
    .where(eq(s.persons.userId, user))
  const reflectionIds: string[] = []
  for (const status of ["PENDING", "SUBMITTED", "RETURNED", "APPROVED"]) {
    const reflection = await task(status)
    reflectionIds.push(reflection.id)
    await db.insert(s.isolationReflectionTasks).values({
      isolationOrderId: order!.id,
      taskId: reflection.id,
      dayKey: "2026-08-31",
      templateKey: status,
    })
  }
  const unrelated = await task()
  const [submittedReflection] = await db
    .insert(s.reportSubmissions)
    .values({
      taskId: reflectionIds[1]!,
      userId: user,
      content: "待审核检讨",
    })
    .returning()
  await reconcileTaskOutcomeScoreWeeks(monday)
  expect(await events()).toMatchObject([{ weekKey: "2026-08-24", points: -2 }])
  expect(await reviews()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        weekKey: "2026-08-24",
        totalScore: -2,
        result: "ISOLATION",
      }),
      expect.objectContaining({
        weekKey: "2026-08-31",
        totalScore: 0,
        result: "CLEAR",
      }),
    ]),
  )
  expect(
    await db
      .select()
      .from(s.isolationOrders)
      .where(eq(s.isolationOrders.id, order!.id)),
  ).toMatchObject([{ status: "CANCELLED" }])
  expect(
    await db.select().from(s.persons).where(eq(s.persons.userId, user)),
  ).toMatchObject([{ custodyStatus: "IN_CUSTODY" }])
  for (const [i, id] of reflectionIds.entries())
    expect(
      await db.select().from(s.reportTasks).where(eq(s.reportTasks.id, id)),
    ).toMatchObject([{ status: i === 3 ? "APPROVED" : "CANCELLED" }])
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, unrelated.id)),
  ).toMatchObject([{ status: "PENDING" }])
  expect(await reconcileTaskOutcomeScoreWeeks(monday)).toBe(0)
  expect(
    await db
      .select()
      .from(s.notices)
      .where(
        and(
          eq(s.notices.title, "积分周结更正"),
          sql`${s.notices.content} like ${`%e2e_${user}%`}`,
        ),
      ),
  ).toHaveLength(1)
  // A scheduler may still hold an ACTIVE snapshot fetched before cancellation.
  expect(await ensureIsolationReflectionTask(order!, monday)).toBeNull()
  await as(admin, "ADMIN")
  expect(
    (
      await review(
        request({ submissionId: submittedReflection!.id, result: "APPROVED" }),
      )
    ).status,
  ).toBe(409)
  await runReportTaskOutcomeSweep(new Date("2026-09-01T00:01:00+08:00"))
  expect(
    (await events()).filter((event) =>
      reflectionIds.includes(event.sourceId ?? ""),
    ),
  ).toHaveLength(0)
})

test("周结后正确归属的审核回填会重算并撤销禁闭", async () => {
  await recordScoreEvent({
    supervisedId: user,
    points: -1,
    reason: "fixture",
    source: "MANUAL",
    weekKey: "2026-08-24",
  })
  const row = await task()
  await runWeeklyScoreReview(monday)
  expect(await reviews()).toMatchObject([
    { totalScore: -1, result: "ISOLATION" },
  ])
  const [order] = await db
    .select()
    .from(s.isolationOrders)
    .where(eq(s.isolationOrders.supervisedId, user))
  expect(order?.status).toBe("ACTIVE")
  const linked = await db
    .select()
    .from(s.isolationReflectionTasks)
    .where(eq(s.isolationReflectionTasks.isolationOrderId, order!.id))
  expect(linked.length).toBeGreaterThan(0)
  await as(user, "SUPERVISED")
  const response = await submit(request({ taskId: row.id, data: {} }))
  expect(response.status).toBe(201)
  const submissionId = (await response.json()).data.id
  await as(admin, "ADMIN")
  expect(
    (await review(request({ submissionId, result: "APPROVED" }))).status,
  ).toBe(201)
  await runWeeklyScoreReview(monday)
  await runWeeklyScoreReview(monday)
  expect(await reviews()).toMatchObject([{ totalScore: 1, result: "CLEAR" }])
  expect(
    await db
      .select()
      .from(s.isolationOrders)
      .where(eq(s.isolationOrders.id, order!.id)),
  ).toMatchObject([{ status: "CANCELLED" }])
  for (const link of linked)
    expect(
      await db
        .select()
        .from(s.reportTasks)
        .where(eq(s.reportTasks.id, link.taskId)),
    ).toMatchObject([{ status: "CANCELLED" }])
  expect(await ensureIsolationReflectionTask(order!, monday)).toBeNull()
})

test("周结主动处理到期任务，后续重跑不重复扣分或派发检讨", async () => {
  await task("PENDING", new Date("2026-08-31T00:01:00+08:00"))
  await runWeeklyScoreReview(monday)
  await runWeeklyScoreReview(monday)
  expect(await reviews()).toMatchObject([
    { totalScore: -2, result: "ISOLATION" },
  ])
  expect(await events()).toHaveLength(1)
  const orders = await db
    .select()
    .from(s.isolationOrders)
    .where(eq(s.isolationOrders.supervisedId, user))
  expect(orders).toHaveLength(1)
  const links = await db
    .select()
    .from(s.isolationReflectionTasks)
    .where(eq(s.isolationReflectionTasks.isolationOrderId, orders[0]!.id))
  expect(links.length).toBeGreaterThan(0)
  await ensureIsolationReflectionTask(orders[0]!, monday)
  expect(
    await db
      .select()
      .from(s.isolationReflectionTasks)
      .where(eq(s.isolationReflectionTasks.isolationOrderId, orders[0]!.id)),
  ).toHaveLength(links.length)
})

test("周结后补卡更正重算到零分，撤销禁闭且日结流水不重复", async () => {
  const [rule] = await db
    .insert(s.rules)
    .values({ name: `e2e_${user}` })
    .returning()
  try {
    const checkins = await db
      .insert(s.checkinTasks)
      .values([
        {
          ruleId: rule!.id,
          supervisedId: user,
          slotIndex: 0,
          scheduleAt: sunday,
          deadline: sunday,
          status: "COMPLETED",
        },
        {
          ruleId: rule!.id,
          supervisedId: user,
          slotIndex: 1,
          scheduleAt: new Date(sunday.getTime() - 60_000),
          deadline: sunday,
          status: "MISSED",
        },
      ])
      .returning()
    await recordScoreEvent({
      supervisedId: user,
      points: -4,
      reason: "fixture",
      source: "MANUAL",
      weekKey: "2026-08-24",
    })
    await runWeeklyScoreReview(monday)
    expect(await reviews()).toMatchObject([
      { totalScore: -1, result: "ISOLATION" },
    ])
    const before = (await events()).find(
      (event) => event.source === "CHECKIN_DAILY",
    )!
    await db
      .update(s.checkinTasks)
      .set({ status: "MAKEUP_APPROVED" })
      .where(eq(s.checkinTasks.id, checkins[1]!.id))
    await runWeeklyScoreReview(monday)
    expect(await reviews()).toMatchObject([{ totalScore: 0, result: "CLEAR" }])
    expect(await events()).toHaveLength(2)
    expect(
      (await events()).find((event) => event.source === "CHECKIN_DAILY"),
    ).toMatchObject({ id: before.id, points: 4, weekKey: "2026-08-24" })
    expect(
      await db
        .select()
        .from(s.isolationOrders)
        .where(eq(s.isolationOrders.supervisedId, user)),
    ).toMatchObject([{ status: "CANCELLED" }])
  } finally {
    await db.delete(s.rules).where(eq(s.rules.id, rule!.id))
  }
})

test.each(["submit", "draft", "review"])(
  "%s 等待数据库锁跨过截止时间后不能写入",
  async (operation) => {
    const row = await task(
      operation === "review" ? "SUBMITTED" : "PENDING",
      new Date(monday.getTime() + 1000),
    )
    let submissionId: string | undefined
    if (operation === "review") {
      const [submission] = await db
        .insert(s.reportSubmissions)
        .values({ taskId: row.id, userId: user, content: "原始内容" })
        .returning()
      submissionId = submission!.id
    }
    await as(
      operation === "review" ? admin : user,
      operation === "review" ? "ADMIN" : "SUPERVISED",
    )
    const blocker = await db.$client.connect()
    let pending: Promise<Response> | undefined
    try {
      await blocker.query("BEGIN")
      await blocker.query(
        "select id from report_tasks where id = $1 for update",
        [row.id],
      )
      pending =
        operation === "review"
          ? review(request({ submissionId, result: "APPROVED" }))
          : (operation === "submit" ? submit : saveDraft)(
              request({ taskId: row.id, data: {} }),
            )
      await expect
        .poll(async () => {
          const waiting = await db.execute(
            sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%report_tasks%'`,
          )
          return waiting.rows[0]?.count
        })
        .toBe(1)
      vi.setSystemTime(new Date(monday.getTime() + 2000))
      await blocker.query("COMMIT")
      expect((await pending).status).toBe(409)
      expect(await events()).toHaveLength(0)
      expect(
        await db
          .select()
          .from(s.reportReviews)
          .where(
            eq(s.reportReviews.submissionId, submissionId ?? randomUUID()),
          ),
      ).toHaveLength(0)
      expect(
        await db
          .select()
          .from(s.reportSubmissions)
          .where(eq(s.reportSubmissions.taskId, row.id)),
      ).toHaveLength(operation === "review" ? 1 : 0)
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
      await pending
    }
  },
)

test("未登录、他人任务与无监管关系的接口请求被拒绝", async () => {
  const row = await task("SUBMITTED")
  const [submission] = await db
    .insert(s.reportSubmissions)
    .values({ taskId: row.id, userId: user, content: "私有内容" })
    .returning()
  cookie.token = ""
  expect((await submit(request({ taskId: row.id, data: {} }))).status).toBe(401)
  expect(
    (
      await adjustScore(
        request({ supervisedId: user, points: 10, reason: "越权测试" }),
      )
    ).status,
  ).toBe(401)
  const outsider = await account("SUPERVISED")
  await as(outsider, "SUPERVISED")
  expect((await submit(request({ taskId: row.id, data: {} }))).status).toBe(403)
  expect((await saveDraft(request({ taskId: row.id, data: {} }))).status).toBe(
    403,
  )
  expect(
    (
      await review(
        request({ submissionId: submission!.id, result: "APPROVED" }),
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await adjustScore(
        request({ supervisedId: user, points: 10, reason: "越权测试" }),
      )
    ).status,
  ).toBe(403)
  const supervisor = await account("SUPERVISOR")
  await as(supervisor, "SUPERVISOR")
  expect(
    (
      await review(
        request({ submissionId: submission!.id, result: "APPROVED" }),
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await adjustScore(
        request({ supervisedId: user, points: 10, reason: "越权测试" }),
      )
    ).status,
  ).toBe(403)
  expect(await events()).toHaveLength(0)
})

test("手动积分写入与审计日志原子提交，审计失败不能留下无日志积分", async () => {
  await as(admin, "ADMIN")
  const failure = vi
    .spyOn(audit, "writeAuditLog")
    .mockRejectedValueOnce(new Error("E2E audit unavailable"))
  const logged = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(
      (
        await adjustScore(
          request({ supervisedId: user, points: 10, reason: "审计回滚测试" }),
        )
      ).status,
    ).toBe(500)
    expect(await events()).toHaveLength(0)
  } finally {
    failure.mockRestore()
    logged.mockRestore()
  }
  expect(
    (
      await adjustScore(
        request({ supervisedId: user, points: 10, reason: "审计回滚测试" }),
      )
    ).status,
  ).toBe(201)
  const saved = await events()
  expect(saved).toHaveLength(1)
  expect(
    await db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.entityId, saved[0]!.id)),
  ).toHaveLength(1)
})
