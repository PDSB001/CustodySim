import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { getAdminUserId } from "@/lib/supervision-scope"
import { POST as checkin } from "@/app/api/checkins/route"
import { GET as listMakeups, POST as applyMakeup } from "@/app/api/makeups/route"
import { GET as listHistory } from "@/app/api/supervision/checkins/route"
import { GET as listRecords } from "@/app/api/supervision/checkins/records/route"

// 只替身 Next 的 cookie 读取；JWT 校验、角色判断与路由逻辑保持真实。
const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
  headers: async () => new Headers(),
}))

/** 1×1 PNG，解码后 67 字节，远小于单张 1MB 上限。 */
const IMAGE_A =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
/** 补卡强制要求能解析出 IP 定位，非生产环境信任 x-real-ip，用公网 IP 让 geoip-lite 命中。 */
const PUBLIC_IP = "8.8.8.8"

const ids: string[] = []
const ruleIds: string[] = []
let admin: string

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

function get(url: string) {
  return new NextRequest(url, {
    method: "GET",
    headers: { "x-real-ip": PUBLIC_IP },
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

/** 打卡明细接口的 URL 构造：userId 必填，其余按需追加。 */
function recordsUrl(userId: string, extra = "") {
  return `http://localhost/api/supervision/checkins/records?userId=${userId}${extra}`
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  // 补卡提交要求库中存在管理处账号，否则 API 直接 400。
  admin = await account("ADMIN")
  expect(await getAdminUserId()).toBeTruthy()
})

afterAll(async () => {
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    // rules 被 checkin_tasks / checkin_makeups 引用且无级联，必须先清子表。
    await db.delete(s.checkinMakeups).where(inArray(s.checkinMakeups.userId, ids))
    await db.delete(s.checkinRecords).where(inArray(s.checkinRecords.userId, ids))
    await db.delete(s.checkinTasks).where(inArray(s.checkinTasks.supervisedId, ids))
    await db.delete(s.persons).where(inArray(s.persons.userId, ids))
  }
  if (ruleIds.length)
    await db.delete(s.rules).where(inArray(s.rules.id, ruleIds))
  if (ids.length) await db.delete(s.users).where(inArray(s.users.id, ids))
  await db.$client.end()
})

test("打卡明细按人下发：状态筛选与游标分页可用，非法参数被拒绝", async () => {
  const supervised = await account("SUPERVISED")
  await as(supervised, "SUPERVISED")

  const withPhoto = await checkinTask(supervised)
  expect(
    (
      await checkin(
        request({ taskId: withPhoto.id, photo: IMAGE_A, locationSource: "IP" }),
      )
    ).status,
  ).toBe(201)
  const plain = await checkinTask(supervised)
  expect(
    (await checkin(request({ taskId: plain.id, locationSource: "IP" }))).status,
  ).toBe(201)

  await as(admin, "ADMIN")
  const first = await listRecords(get(recordsUrl(supervised, "&limit=1")))
  expect(first.status).toBe(200)
  const page1 = (await first.json()).data as {
    items: Array<{ id: string; status: string; photoUrl: string | null }>
    nextCursor: string | null
  }
  expect(page1.items).toHaveLength(1)
  expect(page1.nextCursor).toBeTruthy()

  // 游标 `checkinAt|id` 必须整体转义（内含 `|`），否则第二页会拿到重复行。
  const second = await listRecords(
    get(
      recordsUrl(
        supervised,
        `&limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      ),
    ),
  )
  const page2 = (await second.json()).data as {
    items: Array<{ id: string; photoUrl: string | null }>
    nextCursor: string | null
  }
  expect(page2.items).toHaveLength(1)
  expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id)
  expect(page2.nextCursor).toBeNull()
  // 照片随明细原样回读（两条记录一有一无，用集合判定避免依赖排序稳定性）。
  expect([...page1.items, ...page2.items].map((row) => row.photoUrl)).toContain(
    IMAGE_A,
  )

  // 用响应里真实存在的状态值做正向筛选，避免把状态枚举硬编码进测试。
  const status = page1.items[0]!.status
  const filtered = await listRecords(get(recordsUrl(supervised, `&status=${status}`)))
  const filteredBody = (await filtered.json()).data as {
    items: Array<{ status: string }>
  }
  expect(filteredBody.items.length).toBeGreaterThan(0)
  expect(filteredBody.items.every((row) => row.status === status)).toBe(true)

  expect(
    (await listRecords(get(recordsUrl(supervised, "&status=NOT_A_STATUS")))).status,
  ).toBe(400)
  expect((await listRecords(get(recordsUrl(supervised, "&limit=2")))).status).toBe(
    200,
  )
  expect((await listRecords(get("http://localhost/api/supervision/checkins/records?limit=2"))).status).toBe(
    400,
  )
  // from 含 / to 不含，且 from >= to 视为参数非法。
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const emptyRange = await listRecords(get(recordsUrl(supervised, `&from=${future}`)))
  expect(((await emptyRange.json()).data as { items: unknown[] }).items).toHaveLength(0)
  expect(
    (
      await listRecords(
        get(recordsUrl(supervised, `&from=2026-01-02&to=2026-01-01`)),
      )
    ).status,
  ).toBe(400)
})

test("打卡明细按监管范围收敛：范围外一律空列表", async () => {
  const supervised = await account("SUPERVISED")
  await as(supervised, "SUPERVISED")
  const task = await checkinTask(supervised)
  expect(
    (await checkin(request({ taskId: task.id, locationSource: "IP" }))).status,
  ).toBe(201)

  // 没有任何监管关系的监管员：看不到辖区外的人，也不报错（不区分"不存在"与"不可见"）。
  const outsider = await account("SUPERVISOR")
  await as(outsider, "SUPERVISOR")
  const byOutsider = await listRecords(get(recordsUrl(supervised)))
  expect(byOutsider.status).toBe(200)
  expect(await byOutsider.json()).toMatchObject({
    data: { items: [], nextCursor: null },
  })

  // 被监管人只能看自己：问别人同样是空列表。
  const peer = await account("SUPERVISED")
  await as(peer, "SUPERVISED")
  const byPeer = await listRecords(get(recordsUrl(supervised)))
  expect(await byPeer.json()).toMatchObject({
    data: { items: [], nextCursor: null },
  })
})

test("补卡审核后可按状态回看已审记录与审批意见", async () => {
  const supervised = await account("SUPERVISED")
  const task = await checkinTask(supervised, "MISSED")
  await as(supervised, "SUPERVISED")

  const applied = await applyMakeup(
    request({
      taskId: task.id,
      reason: "当日设备故障",
      photo: IMAGE_A,
      locationSource: "IP",
    }),
  )
  expect(applied.status).toBe(201)
  const makeupId = (await applied.json()).data.id as string

  // 直接置为已审：这里要验的是队列查询的状态收敛与审批字段下发，
  // 审批链路本身由 attachments 用例覆盖，不重复依赖 PATCH 处理器签名。
  const reviewedAt = new Date()
  await db
    .update(s.checkinMakeups)
    .set({
      status: "APPROVED",
      reviewComment: "凭证有效，同意补卡",
      reviewedAt,
      reviewerId: admin,
    })
    .where(eq(s.checkinMakeups.id, makeupId))

  await as(admin, "ADMIN")
  // 默认（不传 status）仍是待审队列：已批准的不再出现，既有调用方语义不变。
  const defaultQueue = (await (await listMakeups()).json()).data as Array<{
    id: string
  }>
  expect(defaultQueue.map((row) => row.id)).not.toContain(makeupId)

  const approved = await listMakeups(
    new NextRequest("http://localhost/api/makeups?status=APPROVED"),
  )
  expect(approved.status).toBe(200)
  const approvedRows = (await approved.json()).data as Array<{
    id: string
    status: string
    reviewComment: string | null
    reviewedAt: string | null
  }>
  expect(approvedRows.find((row) => row.id === makeupId)).toMatchObject({
    status: "APPROVED",
    reviewComment: "凭证有效，同意补卡",
  })
  expect(approvedRows.find((row) => row.id === makeupId)?.reviewedAt).toBeTruthy()

  const all = (await (
    await listMakeups(new NextRequest("http://localhost/api/makeups?status=ALL"))
  ).json()).data as Array<{ id: string }>
  expect(all.map((row) => row.id)).toContain(makeupId)

  // 未知状态值回落到默认待审队列，不会退化成"全量下发"。
  const bogus = (await (
    await listMakeups(new NextRequest("http://localhost/api/makeups?status=BOGUS"))
  ).json()).data as Array<{ id: string }>
  expect(bogus.map((row) => row.id)).not.toContain(makeupId)
})

test("当日概览下发逐时段分布，且与异常/完成计数同源", async () => {
  const supervised = await account("SUPERVISED")
  await as(supervised, "SUPERVISED")
  // 一个时段真打了卡，另一个留着不打卡：分布里要能同时看到两种状态。
  const done = await checkinTask(supervised)
  expect(
    (await checkin(request({ taskId: done.id, locationSource: "IP" }))).status,
  ).toBe(201)
  await checkinTask(supervised)

  await as(admin, "ADMIN")
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(new Date())
  const response = await listHistory(
    new NextRequest(
      `http://localhost/api/supervision/checkins?date=${today}`,
    ),
  )
  expect(response.status).toBe(200)
  const rows = (await response.json()).data as Array<{
    supervisedId: string
    scheduledCount: number
    completedCount: number
    exceptionCount: number
    slots?: Array<{ slotIndex: number; scheduleAt: string; status: string }>
  }>
  const mine = rows.find((row) => row.supervisedId === supervised)
  expect(mine?.scheduledCount).toBe(2)
  expect(mine?.slots).toHaveLength(2)

  // 关键不变式：时段分布与计数同源 —— "异常 N"时分布里必有 N 个异常时段，
  // 不会再出现"汇总说漏了 4 次、分布却是空的"。
  const slots = mine?.slots ?? []
  const completed = slots.filter((slot) => slot.status === "COMPLETED").length
  const exception = slots.filter((slot) =>
    ["LATE", "MISSED", "MAKEUP_PENDING", "MAKEUP_REJECTED"].includes(slot.status),
  ).length
  expect(completed).toBe(mine?.completedCount)
  expect(exception).toBe(mine?.exceptionCount)
  expect(slots.map((slot) => slot.status)).toContain("PENDING")
})
