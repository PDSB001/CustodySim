import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { LOCATION_MAX_POINTS_PER_DAY } from "@/lib/location-reporting"
import { POST as reportBatch } from "@/app/api/mobile/location/batch/route"
import { GET as getConfig } from "@/app/api/mobile/location/config/route"
import { GET as getTrack } from "@/app/api/mobile/location/track/route"

const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
  headers: async () => new Headers(),
}))

/** 围栏中心（上海），半径 200 米；偏 0.01 度纬度约 1113 米，足以判为越界。 */
const CENTER = { latitude: 31.23, longitude: 121.47 }
const OUTSIDE = { latitude: 31.24, longitude: 121.47 }
const RADIUS_METERS = 200

const ids: string[] = []
const relationIds: string[] = []

async function account(role: "SUPERVISED" | "SUPERVISOR") {
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

async function as(id: string, role: "SUPERVISED" | "SUPERVISOR") {
  cookie.token = await signToken({ userId: id, role, tokenVersion: 0 })
}

/** 人员专属围栏：断言不依赖 e2e 库里可能存在的全局默认围栏。 */
async function createPersonalFence(userId: string) {
  await db.insert(s.electronicFences).values({
    entryType: "CONFIG",
    name: "e2e 围栏",
    latitude: String(CENTER.latitude),
    longitude: String(CENTER.longitude),
    radiusMeters: RADIUS_METERS,
    boundaryPoints: [],
    coordinateSystem: "GCJ02",
    enabled: true,
    userId,
  })
}

/** 建立监管关系：监管员只有落在范围内才能查询他人轨迹。 */
async function relate(supervisorId: string, supervisedId: string) {
  const [relation] = await db
    .insert(s.supervisionRelations)
    .values({
      name: `e2e_relation_${randomUUID()}`,
      status: "active",
      startDate: new Date(Date.now() - 3_600_000),
      endDate: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: s.supervisionRelations.id })
  relationIds.push(relation!.id)
  await db.insert(s.supervisionRelationScopes).values([
    {
      relationId: relation!.id,
      side: "SUPERVISOR",
      targetType: "USER",
      targetId: supervisorId,
    },
    {
      relationId: relation!.id,
      side: "SUPERVISED",
      targetType: "USER",
      targetId: supervisedId,
    },
  ])
}

function pointAt(minutesAgo: number, at = CENTER) {
  return {
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyMeters: 10,
    capturedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  }
}

/** 固定时间点：重发场景必须复用**完全相同的 capturedAt**，否则算不上重复。 */
function pointAtMs(ms: number, at = CENTER) {
  return {
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyMeters: 10,
    capturedAt: new Date(ms).toISOString(),
  }
}

function report(points: unknown[]) {
  return new NextRequest("http://localhost/api/mobile/location/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ coordinateSystem: "GCJ02", points }),
  })
}

function track(query: string) {
  return new NextRequest(`http://localhost/api/mobile/location/track${query}`)
}

async function locationRows(userId: string) {
  return db
    .select({
      reportedAt: s.electronicFences.reportedAt,
      verdict: s.electronicFences.verdict,
      transition: s.electronicFences.transition,
    })
    .from(s.electronicFences)
    .where(
      and(
        eq(s.electronicFences.entryType, "LOCATION"),
        eq(s.electronicFences.userId, userId),
      ),
    )
    .orderBy(asc(s.electronicFences.reportedAt))
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
})

afterAll(async () => {
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    // 一次删掉本人名下全部围栏行（CONFIG 与 LOCATION 都带 userId）
    await db.delete(s.electronicFences).where(inArray(s.electronicFences.userId, ids))
    await db.delete(s.reportTasks).where(inArray(s.reportTasks.supervisedId, ids))
    await db.delete(s.persons).where(inArray(s.persons.userId, ids))
  }
  if (relationIds.length)
    await db
      .delete(s.supervisionRelations)
      .where(inArray(s.supervisionRelations.id, relationIds))
  if (ids.length) await db.delete(s.users).where(inArray(s.users.id, ids))
  await db.$client.end()
})

test("围栏内的批量上报落库为 LOCATION 行，判定与计数正确", async () => {
  const user = await account("SUPERVISED")
  await createPersonalFence(user)
  await as(user, "SUPERVISED")

  const response = await reportBatch(
    report([pointAt(30), pointAt(29), pointAt(28)]),
  )
  expect(response.status).toBe(201)
  const body = (await response.json()).data
  expect(body.accepted).toBe(3)
  expect(body.skipped).toBe(0)
  expect(body.crossings).toBe(0)
  expect(body.last.verdict).toBe("INSIDE")

  const rows = await locationRows(user)
  expect(rows).toHaveLength(3)
  expect(rows.map((row) => row.verdict)).toEqual(["INSIDE", "INSIDE", "INSIDE"])
})

test("重复或回退的时间点被跳过而不报错，客户端可据此清队列", async () => {
  const user = await account("SUPERVISED")
  await createPersonalFence(user)
  await as(user, "SUPERVISED")

  // 固定基准时间，两个批次复用同一批 capturedAt —— 这才是设备重试的真实形态
  const base = Date.now()
  const older = pointAtMs(base - 20 * 60_000)
  const middle = pointAtMs(base - 19 * 60_000)
  const newer = pointAtMs(base - 18 * 60_000)

  const first = await reportBatch(report([older, middle]))
  expect((await first.json()).data.accepted).toBe(2)

  // 重发已经提交过的两个点，再加一个更新的点
  const second = await reportBatch(report([older, middle, newer]))
  expect(second.status).toBe(201)
  const body = (await second.json()).data
  expect(body.accepted).toBe(1)
  expect(body.skipped).toBe(2)

  expect(await locationRows(user)).toHaveLength(3)
})

test("越界会按天幂等建任务，多次越界只留一条任务但 crossings 如实计数", async () => {
  const user = await account("SUPERVISED")
  await createPersonalFence(user)
  await as(user, "SUPERVISED")

  const response = await reportBatch(
    report([
      pointAt(15, CENTER),
      pointAt(14, OUTSIDE),
      pointAt(13, OUTSIDE),
      pointAt(12, CENTER),
      pointAt(11, OUTSIDE),
    ]),
  )
  expect(response.status).toBe(201)
  const body = (await response.json()).data
  expect(body.accepted).toBe(5)
  expect(body.crossings).toBe(2)

  const tasks = await db
    .select({ id: s.reportTasks.id })
    .from(s.reportTasks)
    .where(
      and(
        eq(s.reportTasks.supervisedId, user),
        eq(s.reportTasks.source, "GEOFENCE"),
      ),
    )
  expect(tasks).toHaveLength(1)
})

test("超出滞后窗口或点数上限的批次被拒绝", async () => {
  const user = await account("SUPERVISED")
  await createPersonalFence(user)
  await as(user, "SUPERVISED")

  // 7 小时前的点超出 6 小时容忍
  expect((await reportBatch(report([pointAt(7 * 60)]))).status).toBe(400)

  // 181 个点超过单批上限 180
  const tooMany = Array.from({ length: 181 }, (_, index) =>
    pointAt(index + 1),
  )
  expect((await reportBatch(report(tooMany))).status).toBe(400)
})

test("近 24 小时点数达到上限后返回 429", async () => {
  const user = await account("SUPERVISED")
  await createPersonalFence(user)
  await as(user, "SUPERVISED")

  const now = Date.now()
  await db.insert(s.electronicFences).values(
    Array.from({ length: LOCATION_MAX_POINTS_PER_DAY }, (_, index) => ({
      entryType: "LOCATION",
      name: "移动端定位上报",
      latitude: String(CENTER.latitude),
      longitude: String(CENTER.longitude),
      radiusMeters: RADIUS_METERS,
      coordinateSystem: "GCJ02",
      enabled: true,
      userId: user,
      // 30 秒一条：1584 条全部落在 24 小时滚动窗口内（13.2 小时跨度）
      reportedAt: new Date(now - (index + 1) * 30_000),
      accuracyMeters: 10,
      verdict: "INSIDE",
      transition: "INSIDE",
    })),
  )

  const response = await reportBatch(report([pointAt(1)]))
  expect(response.status).toBe(429)
})

test("轨迹查询按升序返回坐标，并拒绝越权与超窗查询", async () => {
  const user = await account("SUPERVISED")
  const guard = await account("SUPERVISOR")
  const outsider = await account("SUPERVISED")
  await createPersonalFence(user)
  await relate(guard, user)

  await as(user, "SUPERVISED")
  // 被监管人本人也不能查看轨迹（产品决定：不对被监管人开放）
  expect((await getTrack(track(`?userId=${user}`))).status).toBe(403)
  await reportBatch(report([pointAt(10), pointAt(9)]))

  await as(guard, "SUPERVISOR")
  const response = await getTrack(track(`?userId=${user}`))
  expect(response.status).toBe(200)
  const body = (await response.json()).data
  expect(body.retentionHours).toBe(72)
  expect(body.points).toHaveLength(2)
  expect(body.points[0].latitude).toBe(CENTER.latitude)
  expect(typeof body.points[0].latitude).toBe("number")
  const times = body.points.map((point: { reportedAt: string }) =>
    new Date(point.reportedAt).getTime(),
  )
  expect(times[0]).toBeLessThan(times[1])

  // 不在监管范围内的人员不能查看
  expect((await getTrack(track(`?userId=${outsider}`))).status).toBe(403)
  // 未指定人员时明确报错，而不是回退成"查自己"
  expect((await getTrack(track(""))).status).toBe(400)

  // 查询区间不得超过 72 小时
  const from = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString()
  expect(
    (await getTrack(track(`?userId=${user}&from=${from}`))).status,
  ).toBe(400)
})

test("上报策略端点下发区间与上限", async () => {
  const user = await account("SUPERVISED")
  await as(user, "SUPERVISED")
  const response = await getConfig()
  expect(response.status).toBe(200)
  const body = (await response.json()).data
  expect(body.minIntervalSeconds).toBe(60)
  expect(body.maxIntervalSeconds).toBe(3_600)
  expect(body.maxPointsPerBatch).toBe(180)
  expect(body.retentionHours).toBe(72)
})
