import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { getAdminUserId } from "@/lib/supervision-scope"
import { GET as listCheckins, POST as checkin } from "@/app/api/checkins/route"
import { GET as listMakeups, POST as applyMakeup } from "@/app/api/makeups/route"
import { PATCH as reviewMakeup } from "@/app/api/makeups/[id]/route"
import {
  GET as listApplications,
  POST as applyApplication,
} from "@/app/api/applications/route"
import { GET as listApplicationReviews } from "@/app/api/application-reviews/route"

// 只替身 Next 的 cookie 读取；JWT 校验、角色判断与路由逻辑保持真实。
const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
  // lib/session.ts 现在也读 Authorization 头（原生客户端路径）。这个 mock 是
  // 整体替换 next/headers，缺了 headers 会让所有鉴权路径直接抛错。
  headers: async () => new Headers(),
}))

/** 1×1 PNG，解码后 67 字节，远小于单张 1MB 上限。 */
const IMAGE_A =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const IMAGE_B = "data:image/jpeg;base64,YQ=="
/** gif 不在允许的 jpeg/png/webp 之内。 */
const IMAGE_INVALID = "data:image/gif;base64,R0lGOD"
/**
 * 补卡强制要求能解析出 IP 定位（createCheckinMakeup 无 allowNoLocation 豁免），
 * 非生产环境下 getRequestIp 信任 x-real-ip，这里用公网 IP 让 geoip-lite 命中。
 */
const PUBLIC_IP = "8.8.8.8"

const ids: string[] = []
const ruleIds: string[] = []
const relationIds: string[] = []

async function account(role: "SUPERVISED" | "SUPERVISOR" | "ADMIN") {
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

async function as(id: string, role: "SUPERVISED" | "SUPERVISOR" | "ADMIN") {
  cookie.token = await signToken({ userId: id, role, tokenVersion: 0 })
}

function request(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/e2e", {
    method,
    headers: { "content-type": "application/json", "x-real-ip": PUBLIC_IP },
    body: JSON.stringify(body),
  })
}

/** 造一条点名规则与对应打卡任务，规则显式允许无定位，避免依赖真实网络位置。 */
async function checkinTask(
  supervisedId: string,
  status: "PENDING" | "MISSED" = "PENDING",
) {
  const [rule] = await db
    .insert(s.rules)
    .values({ name: `e2e_${randomUUID()}`, allowNoLocation: true })
    .returning()
  ruleIds.push(rule!.id)
  const scheduleAt = new Date()
  const [task] = await db
    .insert(s.checkinTasks)
    .values({
      ruleId: rule!.id,
      supervisedId,
      slotIndex: 0,
      scheduleAt,
      deadline: new Date(scheduleAt.getTime() + 3_600_000),
      status,
    })
    .returning()
  return task!
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  // 提交申请要求库中存在管理处账号，否则 API 直接 400。
  await account("ADMIN")
  expect(await getAdminUserId()).toBeTruthy()
})

afterAll(async () => {
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    // rules 被 checkin_tasks / checkin_makeups 引用且无级联，必须先清子表。
    await db.delete(s.checkinMakeups).where(inArray(s.checkinMakeups.userId, ids))
    await db.delete(s.checkinRecords).where(inArray(s.checkinRecords.userId, ids))
    await db.delete(s.checkinTasks).where(inArray(s.checkinTasks.supervisedId, ids))
    await db.delete(s.applications).where(inArray(s.applications.userId, ids))
    await db.delete(s.persons).where(inArray(s.persons.userId, ids))
  }
  if (ruleIds.length)
    await db.delete(s.rules).where(inArray(s.rules.id, ruleIds))
  if (relationIds.length)
    await db
      .delete(s.supervisionRelations)
      .where(inArray(s.supervisionRelations.id, relationIds))
  if (ids.length) await db.delete(s.users).where(inArray(s.users.id, ids))
  await db.$client.end()
})

test("打卡照片落库并可回读，非法格式被拒绝", async () => {
  const user = await account("SUPERVISED")
  const task = await checkinTask(user)
  await as(user, "SUPERVISED")

  const response = await checkin(
    request({ taskId: task.id, photo: IMAGE_A, locationSource: "IP" }),
  )
  expect(response.status).toBe(201)
  expect((await response.json()).data.photoUrl).toBe(IMAGE_A)

  const [record] = await db
    .select()
    .from(s.checkinRecords)
    .where(eq(s.checkinRecords.taskId, task.id))
  expect(record?.photoUrl).toBe(IMAGE_A)

  const listed = (await (await listCheckins()).json()).data as Array<{
    id: string
    recordPhotoUrl: string | null
  }>
  expect(listed.find((row) => row.id === task.id)?.recordPhotoUrl).toBe(IMAGE_A)

  // 非法格式发生在写入之前：另一条任务保持 PENDING 且不产生记录。
  const other = await checkinTask(user)
  expect(
    (await checkin(request({ taskId: other.id, photo: IMAGE_INVALID }))).status,
  ).toBe(400)
  expect(
    await db.select().from(s.checkinRecords).where(eq(s.checkinRecords.taskId, other.id)),
  ).toHaveLength(0)
})

test("补卡凭证落库、本人可回读、非法格式被拒绝", async () => {
  const user = await account("SUPERVISED")
  const task = await checkinTask(user, "MISSED")
  await as(user, "SUPERVISED")

  const response = await applyMakeup(
    request({
      taskId: task.id,
      reason: "漏点补卡凭证",
      photo: IMAGE_A,
      locationSource: "IP",
    }),
  )
  expect(response.status).toBe(201)
  const makeupId = (await response.json()).data.id as string

  const [row] = await db
    .select()
    .from(s.checkinMakeups)
    .where(eq(s.checkinMakeups.id, makeupId))
  expect(row?.photoUrl).toBe(IMAGE_A)

  const mine = (await (await listMakeups()).json()).data as Array<{
    id: string
    photoUrl: string | null
  }>
  expect(mine.find((item) => item.id === makeupId)?.photoUrl).toBe(IMAGE_A)

  const invalid = await checkinTask(user, "MISSED")
  expect(
    (
      await applyMakeup(
        request({
          taskId: invalid.id,
          reason: "非法凭证",
          photo: IMAGE_INVALID,
          locationSource: "IP",
        }),
      )
    ).status,
  ).toBe(400)
  expect(
    await db
      .select()
      .from(s.checkinMakeups)
      .where(eq(s.checkinMakeups.taskId, invalid.id)),
  ).toHaveLength(0)
})

test("补卡核准通过后，新生成的打卡记录继承凭证照片", async () => {
  const user = await account("SUPERVISED")
  const admin = await account("ADMIN")
  const task = await checkinTask(user, "MISSED")

  await as(user, "SUPERVISED")
  const created = await applyMakeup(
    request({
      taskId: task.id,
      reason: "凭证随核准继承",
      photo: IMAGE_B,
      locationSource: "IP",
    }),
  )
  expect(created.status).toBe(201)
  const makeupId = (await created.json()).data.id as string

  // 管理员无需监管关系即可核准。
  await as(admin, "ADMIN")
  const approved = await reviewMakeup(request({ result: "APPROVED" }), {
    params: Promise.resolve({ id: makeupId }),
  })
  expect(approved.status).toBe(200)

  const [record] = await db
    .select()
    .from(s.checkinRecords)
    .where(eq(s.checkinRecords.taskId, task.id))
  expect(record?.status).toBe("MAKEUP")
  expect(record?.photoUrl).toBe(IMAGE_B)
})

test("补卡未被核准时不会产生打卡记录，凭证也不外泄到记录表", async () => {
  const user = await account("SUPERVISED")
  const admin = await account("ADMIN")
  const task = await checkinTask(user, "MISSED")

  await as(user, "SUPERVISED")
  const created = await applyMakeup(
    request({
      taskId: task.id,
      reason: "驳回不生成记录",
      photo: IMAGE_A,
      locationSource: "IP",
    }),
  )
  const makeupId = (await created.json()).data.id as string

  await as(admin, "ADMIN")
  expect(
    (
      await reviewMakeup(request({ result: "REJECTED", comment: "凭证不足" }), {
        params: Promise.resolve({ id: makeupId }),
      })
    ).status,
  ).toBe(200)
  expect(
    await db.select().from(s.checkinRecords).where(eq(s.checkinRecords.taskId, task.id)),
  ).toHaveLength(0)
})

test("申请附件最多 3 张，超出上限或格式非法都会被拒绝", async () => {
  const user = await account("SUPERVISED")
  await as(user, "SUPERVISED")

  const three = await applyApplication(
    request({
      type: "GENERAL",
      reason: "三张附件",
      attachments: [IMAGE_A, IMAGE_B, IMAGE_A],
    }),
  )
  expect(three.status).toBe(201)
  expect((await three.json()).data.attachments).toEqual([
    IMAGE_A,
    IMAGE_B,
    IMAGE_A,
  ])

  expect(
    (
      await applyApplication(
        request({
          type: "GENERAL",
          reason: "四张附件",
          attachments: [IMAGE_A, IMAGE_B, IMAGE_A, IMAGE_B],
        }),
      )
    ).status,
  ).toBe(400)

  expect(
    (
      await applyApplication(
        request({
          type: "GENERAL",
          reason: "非法附件",
          attachments: [IMAGE_INVALID],
        }),
      )
    ).status,
  ).toBe(400)
})

test("申请附件在本人记录与审核侧均可回读", async () => {
  const user = await account("SUPERVISED")
  await as(user, "SUPERVISED")
  const created = await applyApplication(
    request({
      type: "GENERAL",
      reason: "附件可见性",
      attachments: [IMAGE_A, IMAGE_B],
    }),
  )
  expect(created.status).toBe(201)
  const applicationId = (await created.json()).data.id as string

  const mine = (await (await listApplications()).json()).data as Array<{
    id: string
    attachments: string[]
  }>
  expect(mine.find((row) => row.id === applicationId)?.attachments).toEqual([
    IMAGE_A,
    IMAGE_B,
  ])

  // 指派一条本测试管理员自己的审核记录，避免依赖库中已存在的管理员。
  const admin = await account("ADMIN")
  await db.insert(s.applicationReviews).values({
    applicationId,
    reviewerId: admin,
    step: 99,
    result: "PENDING",
  })
  await as(admin, "ADMIN")
  const queue = (await (await listApplicationReviews()).json()).data as Array<{
    applicationId: string
    attachments: string[]
  }>
  expect(queue.find((row) => row.applicationId === applicationId)?.attachments).toEqual(
    [IMAGE_A, IMAGE_B],
  )
})

test("照片与附件均为可选：三个流程不带图片都能正常提交", async () => {
  const user = await account("SUPERVISED")
  await as(user, "SUPERVISED")

  const task = await checkinTask(user)
  const checkinResponse = await checkin(
    request({ taskId: task.id, locationSource: "IP" }),
  )
  expect(checkinResponse.status).toBe(201)
  expect((await checkinResponse.json()).data.photoUrl).toBeNull()

  const missed = await checkinTask(user, "MISSED")
  const makeupResponse = await applyMakeup(
    request({ taskId: missed.id, reason: "不带凭证的补卡", locationSource: "IP" }),
  )
  expect(makeupResponse.status).toBe(201)
  expect((await makeupResponse.json()).data.photoUrl).toBeNull()

  const applicationResponse = await applyApplication(
    request({ type: "GENERAL", reason: "不带附件的申请" }),
  )
  expect(applicationResponse.status).toBe(201)
  expect((await applicationResponse.json()).data.attachments).toEqual([])
})
