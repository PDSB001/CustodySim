import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { POST as submit } from "@/app/api/submissions/route"
import { GET as listReviews, POST as review } from "@/app/api/reviews/route"

// 只替身 Next 的 cookie 读取；JWT 校验、角色判断、事务与计分保持真实。
const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
  headers: async () => new Headers(),
}))

const ids: string[] = []
const submissionIds: string[] = []
let admin: string

async function account(role: "SUPERVISED" | "ADMIN") {
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

async function as(id: string, role: "SUPERVISED" | "ADMIN") {
  cookie.token = await signToken({ userId: id, role, tokenVersion: 0 })
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/e2e", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

function get(url: string) {
  return new NextRequest(url, { method: "GET" })
}

/** 一条待提交的呈报任务；内容校验交给真实路由，这里只造最小骨架。 */
async function task(supervisedId: string) {
  const now = new Date()
  const [row] = await db
    .insert(s.reportTasks)
    .values({
      supervisedId,
      title: "e2e 呈报任务",
      scheduleAt: now,
      deadline: new Date(now.getTime() + 3_600_000),
      status: "PENDING",
      templateSnapshot: { fields: [] },
    })
    .returning()
  return row!
}

/** 走真实提交接口拿到 submissionId，并把 id 记入清理清单。 */
async function submitFor(taskId: string, data: Record<string, unknown>) {
  const response = await submit(request({ taskId, data }))
  expect(response.status).toBe(201)
  const id = (await response.json()).data.id as string
  submissionIds.push(id)
  return id
}

type ReviewItems = {
  items: Array<{
    id: string
    automated: boolean
    snapshotMissing: boolean
    submittedSnapshot: { data?: Record<string, unknown> } | null
  }>
  nextCursor: string | null
}

async function reviewsBy(userId: string, extra = "") {
  const response = await listReviews(
    get(`http://localhost/api/reviews?userId=${userId}${extra}`),
  )
  expect(response.status).toBe(200)
  return (await response.json()).data as ReviewItems
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  admin = await account("ADMIN")
})

afterAll(async () => {
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    await db.delete(s.scoreEvents).where(inArray(s.scoreEvents.supervisedId, ids))
    await db
      .delete(s.scoreWeekReviews)
      .where(inArray(s.scoreWeekReviews.supervisedId, ids))
    // 批阅会发通知，内容里带 e2e_ 前缀；按内容清理。
    for (const id of ids)
      await db
        .delete(s.notices)
        .where(sql`${s.notices.content} like ${`%${id}%`}`)
  }
  if (submissionIds.length) {
    await db
      .delete(s.reportReviews)
      .where(inArray(s.reportReviews.submissionId, submissionIds))
    await db
      .delete(s.reportSubmissions)
      .where(inArray(s.reportSubmissions.id, submissionIds))
  }
  if (ids.length) {
    await db.delete(s.reportTasks).where(inArray(s.reportTasks.supervisedId, ids))
    await db.delete(s.persons).where(inArray(s.persons.userId, ids))
    await db.delete(s.users).where(inArray(s.users.id, ids))
  }
  await db.$client.end()
})

test("批阅时冻结当次提交内容：事后改动提交不影响历史记录", async () => {
  const user = await account("SUPERVISED")
  await as(user, "SUPERVISED")
  const row = await task(user)
  const submissionId = await submitFor(row.id, { answer: "第一版作答" })

  await as(admin, "ADMIN")
  expect(
    (
      await review(
        request({
          submissionId,
          result: "APPROVED",
          grade: 90,
          comment: "内容完整，通过",
        }),
      )
    ).status,
  ).toBe(201)

  // 落库层面确认快照已写入（不是靠响应体自证）。
  const [stored] = await db
    .select({ snapshot: s.reportReviews.submittedSnapshot })
    .from(s.reportReviews)
    .where(eq(s.reportReviews.submissionId, submissionId))
  expect(stored?.snapshot).toMatchObject({ data: { answer: "第一版作答" } })

  // 关键不变式：批阅之后提交内容被改动（重提、纠错等），历史记录仍显示当时那一版。
  await db
    .update(s.reportSubmissions)
    .set({ data: { answer: "事后改过的作答" } })
    .where(eq(s.reportSubmissions.id, submissionId))

  const listed = await reviewsBy(user)
  const record = listed.items.find((item) => item.id.length > 0)
  expect(record?.snapshotMissing).toBe(false)
  expect(record?.submittedSnapshot?.data).toMatchObject({ answer: "第一版作答" })
})

test("早于批阅快照的历史记录：回退当前提交并标注 snapshotMissing", async () => {
  const user = await account("SUPERVISED")
  await as(user, "SUPERVISED")
  const row = await task(user)
  const submissionId = await submitFor(row.id, { answer: "旧记录当前内容" })

  // 直接造一条"没有快照"的历史批阅（模拟 A5 上线前的数据）。
  const [legacy] = await db
    .insert(s.reportReviews)
    .values({
      submissionId,
      reviewerId: admin,
      result: "APPROVED",
      comment: "历史批阅",
    })
    .returning()

  const listed = await reviewsBy(user, "&limit=1")
  expect(listed.items[0]?.id).toBe(legacy!.id)
  expect(listed.items[0]?.snapshotMissing).toBe(true)
  // 回退到当前提交内容，界面上会同时给出"未必与当时一致"的提示。
  expect(listed.items[0]?.submittedSnapshot?.data).toMatchObject({
    answer: "旧记录当前内容",
  })
})

test("批阅记录支持按人、时间范围与 AI/人工筛选，并可游标翻页", async () => {
  const mine = await account("SUPERVISED")
  const other = await account("SUPERVISED")

  await as(mine, "SUPERVISED")
  const first = await submitFor((await task(mine)).id, { answer: "一" })
  const second = await submitFor((await task(mine)).id, { answer: "二" })
  await as(other, "SUPERVISED")
  const foreign = await submitFor((await task(other)).id, { answer: "别人的" })

  await as(admin, "ADMIN")
  expect(
    (await review(request({ submissionId: first, result: "APPROVED" }))).status,
  ).toBe(201)
  expect(
    (await review(request({ submissionId: second, result: "RETURNED" }))).status,
  ).toBe(201)
  const foreignReview = await review(
    request({ submissionId: foreign, result: "APPROVED" }),
  )
  expect(foreignReview.status).toBe(201)
  const foreignReviewId = (await foreignReview.json()).data.id as string
  // AI 批阅：reviewerId 为空即自动审核，界面显示"AI 系统"。
  const [ai] = await db
    .insert(s.reportReviews)
    .values({ submissionId: second, reviewerId: null, result: "APPROVED" })
    .returning()

  // 按人收敛：本人的两条人工批阅 + 一条 AI 批阅都在，别人的记录不在。
  const mineOnly = await reviewsBy(mine)
  expect(mineOnly.items).toHaveLength(3)
  expect(mineOnly.items.map((item) => item.id)).toContain(ai!.id)
  expect(mineOnly.items.map((item) => item.id)).not.toContain(foreignReviewId)

  // 游标翻页：limit=1 时给出下一页游标，且两页不重复。
  const page1 = await reviewsBy(mine, "&limit=1")
  expect(page1.items).toHaveLength(1)
  expect(page1.nextCursor).toBeTruthy()
  const page2 = await reviewsBy(
    mine,
    `&limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
  )
  expect(page2.items).toHaveLength(1)
  expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id)

  // AI / 人工筛选。
  const aiOnly = await reviewsBy(mine, "&automated=1")
  expect(aiOnly.items.map((item) => item.id)).toEqual([ai!.id])
  const manualOnly = await reviewsBy(mine, "&automated=0")
  expect(manualOnly.items.every((item) => !item.automated)).toBe(true)
  expect(manualOnly.items.map((item) => item.id)).not.toContain(ai!.id)

  // 时间范围：from 取未来时刻应为空（from 含 / to 不含）。
  const future = new Date(Date.now() + 86_400_000).toISOString()
  expect((await reviewsBy(mine, `&from=${future}`)).items).toHaveLength(0)
})

test("未登录与越权读取批阅记录被拒绝", async () => {
  const outsider = await account("SUPERVISED")
  cookie.token = ""
  expect(
    (await listReviews(get("http://localhost/api/reviews?limit=1"))).status,
  ).toBe(401)

  // 被监管人只能看到自己的记录；查别人同样是空列表而不是报错。
  await as(outsider, "SUPERVISED")
  expect((await reviewsBy(outsider)).items).toHaveLength(0)
})
