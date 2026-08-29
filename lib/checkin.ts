import { and, desc, eq, gte, inArray, lt, notInArray } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  checkinMakeups,
  checkinRecords,
  checkinTasks,
  organizations,
  persons,
  ruleGroupScopes,
  ruleScopes,
  rules,
  users,
} from "@/lib/db/schema"
import {
  ensureCustodyCheckinPresets,
  getCustodyProfileForUser,
  isUserInCustody,
  parseCheckinSlotSettings,
} from "@/lib/custody-checkin"
import {
  getGpsExpiry,
  purgeExpiredGpsCheckinData,
} from "@/lib/privacy-retention"
import { getCoarseIpLocation } from "@/lib/ip-location"
import type { IpCoarseLocation } from "@/lib/ip-location"
import {
  computeDeadline,
  isRuleScheduledForDate,
  parseSlots,
  type RuleFrequency,
} from "@/lib/rule-cycle"
import {
  expandRuleTargets,
  resolveScopes,
  type TargetScope,
} from "@/lib/rule-engine"
import {
  buildOrgDescendantsMap,
  getSupervisorIdsForSupervised,
  getSupervisedUserIdsForActor,
  isEffectiveSupervisorForSupervised,
} from "@/lib/supervision-scope"
import { legacyDateAllDay } from "@/lib/shanghai-datetime"
import type { SessionUser } from "@/lib/session"
import {
  getActiveIsolationOrder,
  runCheckinDailyScoreSweep,
} from "@/lib/scoring"

export const CHECKIN_TASK_STATUSES = [
  "PENDING",
  "COMPLETED",
  "LATE",
  "MISSED",
  "MAKEUP_PENDING",
  "MAKEUP_APPROVED",
  "MAKEUP_REJECTED",
  "SYSTEM_MAKEUP",
] as const

export type CheckinTaskStatus = (typeof CHECKIN_TASK_STATUSES)[number]

export type CheckinLocation = {
  label?: string
  lat?: number
  lng?: number
  accuracy?: number
  source?: "GPS"
  ip?: IpCoarseLocation
  gpsExpiresAt?: string
}

export type CheckinLocationSource = "GPS" | "IP"

export class CheckinError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

function dateAtSlot(date: Date, slot: string) {
  const [hours, minutes] = slot.split(":").map(Number)
  const value = new Date(date)
  value.setHours(hours, minutes, 0, 0)
  return value
}

export function getDayRange(date = new Date()) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

export function getCheckinTaskStatus(
  persistedStatus: string,
  deadline: Date,
  now = new Date(),
): CheckinTaskStatus {
  if (persistedStatus !== "PENDING") return persistedStatus as CheckinTaskStatus
  return now > deadline ? "MISSED" : "PENDING"
}

export function getRecordStatus(scheduleAt: Date, deadline: Date, now: Date) {
  if (now < scheduleAt) throw new CheckinError("尚未到打卡时间")
  return now <= deadline ? "ON_TIME" : "LATE"
}

export async function getCheckinRulesForUser(userId: string, now = new Date()) {
  const profile = await getCustodyProfileForUser(userId)
  if (
    !profile ||
    !["IN_CUSTODY", "ON_LEAVE", "ISOLATION"].includes(
      profile.custodyStatus,
    )
  )
    return []
  const isolationOrder = await getActiveIsolationOrder(userId, now)
  const effectiveCustodyLevel =
    profile.custodyStatus === "ISOLATION" || isolationOrder
    ? "ISOLATION"
    : profile.custodyLevel
  await ensureCustodyCheckinPresets()
  const [
    activeRules,
    ownScopes,
    groupScopes,
    allOrganizations,
    supervisedUsers,
  ] = await Promise.all([
    db
      .select()
      .from(rules)
      .where(and(eq(rules.enabled, true), eq(rules.type, "CHECKIN"))),
    db.select().from(ruleScopes),
    db.select().from(ruleGroupScopes),
    db
      .select({ id: organizations.id, parentId: organizations.parentId })
      .from(organizations),
    db
      .select({ id: users.id, organizationId: users.organizationId })
      .from(users)
      .where(and(eq(users.role, "SUPERVISED"), eq(users.status, "active"))),
  ])
  const descendants = buildOrgDescendantsMap(allOrganizations)
  return activeRules.filter((rule) => {
    if (rule.custodyLevel) {
      return (
        rule.custodyLevel === effectiveCustodyLevel &&
        isRuleScheduledForDate(
          {
            freq: rule.freq as RuleFrequency,
            scheduleDays: rule.scheduleDays,
            startDate: rule.startDate,
            endDate: rule.endDate,
          },
          now,
        )
      )
    }
    const scopes = resolveScopes({
      ownScopes: ownScopes.filter(
        (scope) => scope.ruleId === rule.id,
      ) as TargetScope[],
      groupScopes: rule.ruleGroupId
        ? (groupScopes.filter(
            (scope) => scope.groupId === rule.ruleGroupId,
          ) as TargetScope[])
        : [],
    })
    return (
      expandRuleTargets(scopes, descendants, supervisedUsers).has(userId) &&
      isRuleScheduledForDate(
        {
          freq: rule.freq as RuleFrequency,
          scheduleDays: rule.scheduleDays,
          startDate: rule.startDate,
          endDate: rule.endDate,
        },
        now,
      )
    )
  })
}

export async function getOrCreateCheckinTask(
  userId: string,
  rule: {
    id: string
    timeSlots: unknown
    slotSettings?: unknown
    timeoutMinutes: number
  },
  slotIndex: number,
  now = new Date(),
) {
  const slot = parseSlots(rule.timeSlots)[slotIndex]
  if (!slot) throw new CheckinError("打卡时段不存在")
  const slotSetting = parseCheckinSlotSettings(rule.slotSettings).find(
    (item) => item.time === slot,
  )
  const scheduleAt = dateAtSlot(now, slot)
  const supervisorIds = await getSupervisorIdsForSupervised(userId)
  await db
    .insert(checkinTasks)
    .values({
      ruleId: rule.id,
      supervisedId: userId,
      supervisorId: [...supervisorIds][0] ?? null,
      slotIndex,
      scheduleAt,
      deadline: computeDeadline(
        scheduleAt,
        slotSetting?.timeoutMinutes ?? rule.timeoutMinutes,
      ),
    })
    .onConflictDoNothing()
  const [task] = await db
    .select()
    .from(checkinTasks)
    .where(
      and(
        eq(checkinTasks.ruleId, rule.id),
        eq(checkinTasks.supervisedId, userId),
        eq(checkinTasks.scheduleAt, scheduleAt),
      ),
    )
    .limit(1)
  if (!task) throw new CheckinError("打卡任务创建失败", 500)
  return task
}

export async function ensureTodayCheckinTasks(
  userId: string,
  now = new Date(),
) {
  const checkinRules = await getCheckinRulesForUser(userId, now)
  const tasks = []
  for (const rule of checkinRules) {
    for (const [slotIndex] of parseSlots(rule.timeSlots).entries()) {
      tasks.push(await getOrCreateCheckinTask(userId, rule, slotIndex, now))
    }
  }
  return tasks
}

async function ensureLeaveSystemMakeups(userId: string, now: Date) {
  const { start, end } = getDayRange(now)
  const tasks = await db
    .select({
      id: checkinTasks.id,
      slotIndex: checkinTasks.slotIndex,
      scheduleAt: checkinTasks.scheduleAt,
      status: checkinTasks.status,
    })
    .from(checkinTasks)
    .where(
      and(
        eq(checkinTasks.supervisedId, userId),
        gte(checkinTasks.scheduleAt, start),
        lt(checkinTasks.scheduleAt, end),
      ),
    )
  let created = 0
  for (const task of tasks) {
    if (task.status !== "PENDING" || task.scheduleAt > now) continue
    await db.transaction(async (tx) => {
      await tx
        .insert(checkinRecords)
        .values({
          taskId: task.id,
          userId,
          checkinAt: now,
          status: "SYSTEM_MAKEUP",
          slotIndex: task.slotIndex,
          location: { source: "LEAVE_SYSTEM_MAKEUP" },
          locationSource: "SYSTEM",
          clientType: "SYSTEM",
          remark: "请假有效期内系统补卡",
        })
        .onConflictDoNothing()
      await tx
        .update(checkinTasks)
        .set({ status: "SYSTEM_MAKEUP", updatedAt: now })
        .where(
          and(eq(checkinTasks.id, task.id), eq(checkinTasks.status, "PENDING")),
        )
    })
    created += 1
  }
  return created
}

export async function runLeaveSystemMakeupSweep(now = new Date()) {
  const profiles = await db
    .select({ userId: persons.userId })
    .from(persons)
    .where(
      and(
        eq(persons.personType, "SUPERVISED"),
        eq(persons.custodyStatus, "ON_LEAVE"),
      ),
    )
  let created = 0
  for (const profile of profiles) {
    if (!profile.userId) continue
    await ensureTodayCheckinTasks(profile.userId, now)
    created += await ensureLeaveSystemMakeups(profile.userId, now)
  }
  return created
}

const leaveMakeupSchedulerKey = Symbol.for(
  "custodysim.leave-system-makeup-scheduler",
)

export function startLeaveSystemMakeupScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [leaveMakeupSchedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[leaveMakeupSchedulerKey]) return
  void runLeaveSystemMakeupSweep().catch((error: unknown) =>
    console.error("[checkin] initial leave system makeup sweep failed", error),
  )
  const timer = setInterval(
    () =>
      void runLeaveSystemMakeupSweep().catch((error: unknown) =>
        console.error("[checkin] scheduled leave system makeup sweep failed", error),
      ),
    15 * 60 * 1000,
  )
  timer.unref?.()
  runtime[leaveMakeupSchedulerKey] = timer
}

async function markExpiredCheckins(userId: string, now: Date) {
  await db
    .update(checkinTasks)
    .set({ status: "MISSED", updatedAt: now })
    .where(
      and(
        eq(checkinTasks.supervisedId, userId),
        eq(checkinTasks.status, "PENDING"),
        lt(checkinTasks.deadline, now),
      ),
    )
}

export async function runCheckinStatusSweep(now = new Date()) {
  const leaveProfiles = await db
    .select({ userId: persons.userId })
    .from(persons)
    .where(
      and(
        eq(persons.personType, "SUPERVISED"),
        eq(persons.custodyStatus, "ON_LEAVE"),
      ),
    )
  const leaveUserIds = leaveProfiles.flatMap((profile) =>
    profile.userId ? [profile.userId] : [],
  )
  const expiredTasks = await db
    .update(checkinTasks)
    .set({ status: "MISSED", updatedAt: now })
    .where(
      and(
        eq(checkinTasks.status, "PENDING"),
        lt(checkinTasks.deadline, now),
        leaveUserIds.length
          ? notInArray(checkinTasks.supervisedId, leaveUserIds)
          : undefined,
      ),
    )
    .returning({ id: checkinTasks.id, supervisedId: checkinTasks.supervisedId })
  return expiredTasks.length
}

const checkinStatusSchedulerKey = Symbol.for("custodysim.checkin-status-scheduler")

export function startCheckinStatusScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [checkinStatusSchedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[checkinStatusSchedulerKey]) return
  const run = () =>
    void (async () => {
      await runCheckinStatusSweep()
      await runCheckinDailyScoreSweep()
    })().catch((error: unknown) =>
      console.error("[checkin] scheduled status sweep failed", error),
    )
  run()
  const timer = setInterval(run, 5 * 60 * 1000)
  timer.unref?.()
  runtime[checkinStatusSchedulerKey] = timer
}

export async function getTodayCheckinRecords(userId: string, now = new Date()) {
  await purgeExpiredGpsCheckinData(now)
  const profile = await getCustodyProfileForUser(userId)
  if (
    !profile ||
    !["IN_CUSTODY", "ON_LEAVE", "ISOLATION"].includes(
      profile.custodyStatus,
    )
  )
    return []
  await ensureTodayCheckinTasks(userId, now)
  if (profile.custodyStatus === "ON_LEAVE")
    await ensureLeaveSystemMakeups(userId, now)
  await markExpiredCheckins(userId, now)
  const { start, end } = getDayRange(now)
  const rows = await db
    .select({
      id: checkinTasks.id,
      supervisedId: checkinTasks.supervisedId,
      ruleId: checkinTasks.ruleId,
      ruleName: rules.name,
      slotSettings: rules.slotSettings,
      slotIndex: checkinTasks.slotIndex,
      scheduleAt: checkinTasks.scheduleAt,
      deadline: checkinTasks.deadline,
      status: checkinTasks.status,
      needLocation: rules.needLocation,
      allowNoLocation: rules.allowNoLocation,
      needRemark: rules.needRemark,
      recordId: checkinRecords.id,
      recordStatus: checkinRecords.status,
      checkinAt: checkinRecords.checkinAt,
      remark: checkinRecords.remark,
      recordLocation: checkinRecords.location,
      recordLocationSource: checkinRecords.locationSource,
      recordLat: checkinRecords.lat,
      recordLng: checkinRecords.lng,
      recordGpsExpiresAt: checkinRecords.gpsExpiresAt,
      makeupId: checkinMakeups.id,
      makeupStatus: checkinMakeups.status,
      makeupReason: checkinMakeups.reason,
    })
    .from(checkinTasks)
    .innerJoin(rules, eq(rules.id, checkinTasks.ruleId))
    .leftJoin(checkinRecords, eq(checkinRecords.taskId, checkinTasks.id))
    .leftJoin(checkinMakeups, eq(checkinMakeups.taskId, checkinTasks.id))
    .where(
      and(
        eq(checkinTasks.supervisedId, userId),
        gte(checkinTasks.scheduleAt, start),
        lt(checkinTasks.scheduleAt, end),
      ),
    )
    .orderBy(checkinTasks.scheduleAt)
  return rows.map((row) => ({
    ...row,
    slotLabel:
      parseCheckinSlotSettings(row.slotSettings).find(
        (item) => item.time === row.scheduleAt.toTimeString().slice(0, 5),
      )?.label ?? null,
    status: getCheckinTaskStatus(row.status, row.deadline, now),
  }))
}

export async function getSupervisionCheckins(
  actor: SessionUser,
  now = new Date(),
) {
  const ids = [...(await getSupervisedUserIdsForActor(actor))]
  if (!ids.length) return []
  const names = new Map(
    (
      await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ids))
    ).map((user) => [user.id, user.name]),
  )
  const records = await Promise.all(
    ids.map(async (userId) => getTodayCheckinRecords(userId, now)),
  )
  return records.flat().map((record) => ({
    ...record,
    supervisedName: names.get(record.supervisedId) ?? "被监管人",
  }))
}

/**
 * 读取某一自然日的监管范围打卡概览。这个查询完全只读：查看历史时不会
 * 补生成任务，也不会把旧任务写回为缺卡状态。
 */
export async function getSupervisionCheckinHistory(
  actor: SessionUser,
  dateKey: string,
  now = new Date(),
) {
  const range = legacyDateAllDay(dateKey)
  if (!range) throw new CheckinError("日期格式不正确")

  const ids = [...(await getSupervisedUserIdsForActor(actor))]
  if (!ids.length) return []

  const [supervisedUsers, tasks] = await Promise.all([
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids))
      .orderBy(users.name),
    db
      .select({
        supervisedId: checkinTasks.supervisedId,
        status: checkinTasks.status,
        deadline: checkinTasks.deadline,
        checkinAt: checkinRecords.checkinAt,
      })
      .from(checkinTasks)
      .leftJoin(checkinRecords, eq(checkinRecords.taskId, checkinTasks.id))
      .where(
        and(
          inArray(checkinTasks.supervisedId, ids),
          gte(checkinTasks.scheduleAt, new Date(range.startMs)),
          lt(checkinTasks.scheduleAt, new Date(range.endMs)),
        ),
      )
      .orderBy(checkinTasks.scheduleAt),
  ])

  const result = new Map(
    supervisedUsers.map((user) => [
      user.id,
      {
        supervisedId: user.id,
        supervisedName: user.name,
        scheduledCount: 0,
        completedCount: 0,
        exceptionCount: 0,
        pendingCount: 0,
        latestCheckinAt: null as Date | null,
      },
    ]),
  )

  for (const task of tasks) {
    const summary = result.get(task.supervisedId)
    if (!summary) continue
    summary.scheduledCount += 1
    const status = getCheckinTaskStatus(task.status, task.deadline, now)
    if (
      ["COMPLETED", "LATE", "MAKEUP_APPROVED", "SYSTEM_MAKEUP"].includes(status)
    ) {
      summary.completedCount += 1
    }
    if (
      ["LATE", "MISSED", "MAKEUP_PENDING", "MAKEUP_REJECTED"].includes(status)
    ) {
      summary.exceptionCount += 1
    }
    if (["PENDING", "MAKEUP_PENDING"].includes(status))
      summary.pendingCount += 1
    if (
      task.checkinAt &&
      (!summary.latestCheckinAt || task.checkinAt > summary.latestCheckinAt)
    ) {
      summary.latestCheckinAt = task.checkinAt
    }
  }

  return [...result.values()]
}

export async function doCheckin({
  user,
  taskId,
  remark,
  location,
  locationSource = "IP",
  ip,
  userAgent,
  now = new Date(),
}: {
  user: SessionUser
  taskId: string
  remark?: string
  location?: CheckinLocation
  locationSource?: CheckinLocationSource
  ip?: string | null
  userAgent?: string | null
  now?: Date
}) {
  if (user.role !== "SUPERVISED")
    throw new CheckinError("仅被监管人可打卡", 403)
  if (!(await isUserInCustody(user.id)))
    throw new CheckinError("当前非在押状态，无需执行打卡", 403)
  const [task] = await db
    .select({
      id: checkinTasks.id,
      supervisedId: checkinTasks.supervisedId,
      slotIndex: checkinTasks.slotIndex,
      scheduleAt: checkinTasks.scheduleAt,
      deadline: checkinTasks.deadline,
      taskStatus: checkinTasks.status,
      needLocation: rules.needLocation,
      allowNoLocation: rules.allowNoLocation,
      needRemark: rules.needRemark,
    })
    .from(checkinTasks)
    .innerJoin(rules, eq(rules.id, checkinTasks.ruleId))
    .where(eq(checkinTasks.id, taskId))
    .limit(1)
  if (!task) throw new CheckinError("打卡任务不存在", 404)
  if (task.supervisedId !== user.id)
    throw new CheckinError("无权处理该打卡任务", 403)
  if (task.taskStatus !== "PENDING") throw new CheckinError("该打卡任务已处理")
  if (task.needRemark && !remark?.trim())
    throw new CheckinError("请填写打卡备注")
  if (
    locationSource === "GPS" &&
    (typeof location?.lat !== "number" || typeof location?.lng !== "number")
  )
    throw new CheckinError("已启用精确 GPS，请允许浏览器提供定位后再打卡")
  const ipLocation = getCoarseIpLocation(ip)
  const hasIpLocation = Boolean(
    ipLocation.country || ipLocation.region || ipLocation.city,
  )
  if (!hasIpLocation)
    throw new CheckinError("无法获取 IP 定位，打卡需要有效的网络位置", 403)
  const resolvedLocation =
    locationSource === "GPS"
      ? { ...location, source: "GPS", ip: ipLocation }
      : ipLocation
  const recordStatus = getRecordStatus(task.scheduleAt, task.deadline, now)
  const [record] = await db
    .insert(checkinRecords)
    .values({
      taskId: task.id,
      userId: user.id,
      checkinAt: now,
      status: recordStatus,
      slotIndex: task.slotIndex,
      location: resolvedLocation,
      locationSource,
      lat:
        locationSource === "GPS" ? (location?.lat?.toString() ?? null) : null,
      lng:
        locationSource === "GPS" ? (location?.lng?.toString() ?? null) : null,
      gpsExpiresAt: locationSource === "GPS" ? getGpsExpiry(now) : null,
      ip: ip ?? null,
      clientType: "WEB",
      browserType: userAgent?.slice(0, 100) ?? null,
      remark: remark?.trim() || null,
    })
    .returning()
  await db
    .update(checkinTasks)
    .set({
      status: recordStatus === "ON_TIME" ? "COMPLETED" : "LATE",
      updatedAt: now,
    })
    .where(eq(checkinTasks.id, task.id))
  return record
}

export async function createCheckinMakeup({
  user,
  taskId,
  reason,
  location,
  locationSource = "IP",
  ip,
}: {
  user: SessionUser
  taskId: string
  reason: string
  location?: CheckinLocation
  locationSource?: CheckinLocationSource
  ip?: string | null
}) {
  if (user.role !== "SUPERVISED")
    throw new CheckinError("仅被监管人可申请补卡", 403)
  if (!(await isUserInCustody(user.id)))
    throw new CheckinError("当前非在押状态，不能申请补卡", 403)
  const [task] = await db
    .select()
    .from(checkinTasks)
    .where(eq(checkinTasks.id, taskId))
    .limit(1)
  if (!task) throw new CheckinError("打卡任务不存在", 404)
  if (task.supervisedId !== user.id)
    throw new CheckinError("无权申请该补卡", 403)
  if (!["MISSED", "LATE", "MAKEUP_REJECTED"].includes(task.status))
    throw new CheckinError("该打卡状态不能申请补卡")
  const [existing] = await db
    .select({ id: checkinMakeups.id, status: checkinMakeups.status })
    .from(checkinMakeups)
    .where(eq(checkinMakeups.taskId, taskId))
    .limit(1)
  if (existing?.status === "PENDING") throw new CheckinError("补卡申请正在审核")
  const now = new Date()
  if (
    locationSource === "GPS" &&
    (typeof location?.lat !== "number" || typeof location?.lng !== "number")
  )
    throw new CheckinError("已启用精确 GPS，请允许浏览器提供定位后再申请补卡")
  const ipLocation = getCoarseIpLocation(ip)
  const hasIpLocation = Boolean(
    ipLocation.country || ipLocation.region || ipLocation.city,
  )
  if (!hasIpLocation)
    throw new CheckinError("无法获取 IP 定位，补卡需要有效的网络位置", 403)
  const resolvedLocation =
    locationSource === "GPS"
      ? {
          ...location,
          source: "GPS",
          ip: ipLocation,
          gpsExpiresAt: getGpsExpiry(now).toISOString(),
        }
      : ipLocation
  const [makeup] = existing
    ? await db
        .update(checkinMakeups)
        .set({
          reason: reason.trim(),
          status: "PENDING",
          location: resolvedLocation,
          ip: ip ?? null,
          reviewerId: null,
          reviewComment: null,
          reviewedAt: null,
          createdAt: now,
        })
        .where(eq(checkinMakeups.id, existing.id))
        .returning()
    : await db
        .insert(checkinMakeups)
        .values({
          taskId,
          userId: user.id,
          supervisorId: task.supervisorId,
          ruleId: task.ruleId,
          date: task.scheduleAt,
          slotIndex: task.slotIndex,
          reason: reason.trim(),
          location: resolvedLocation,
          ip: ip ?? null,
        })
        .returning()
  await db
    .update(checkinTasks)
    .set({ status: "MAKEUP_PENDING", updatedAt: now })
    .where(eq(checkinTasks.id, taskId))
  return makeup
}

export async function reviewCheckinMakeup({
  actor,
  makeupId,
  result,
  comment,
}: {
  actor: SessionUser
  makeupId: string
  result: "APPROVED" | "REJECTED"
  comment?: string
}) {
  const [makeup] = await db
    .select({
      id: checkinMakeups.id,
      taskId: checkinMakeups.taskId,
      userId: checkinMakeups.userId,
      slotIndex: checkinMakeups.slotIndex,
      status: checkinMakeups.status,
      location: checkinMakeups.location,
      ip: checkinMakeups.ip,
    })
    .from(checkinMakeups)
    .where(eq(checkinMakeups.id, makeupId))
    .limit(1)
  if (!makeup) throw new CheckinError("补卡申请不存在", 404)
  if (!(await isEffectiveSupervisorForSupervised(actor, makeup.userId)))
    throw new CheckinError("无权审核该补卡", 403)
  if (makeup.status !== "PENDING") throw new CheckinError("该补卡申请已处理")
  const now = new Date()
  const [updatedMakeup] = await db
    .update(checkinMakeups)
    .set({
      status: result,
      reviewerId: actor.id,
      reviewComment: comment?.trim() || null,
      reviewedAt: now,
    })
    .where(
      and(
        eq(checkinMakeups.id, makeupId),
        eq(checkinMakeups.status, "PENDING"),
      ),
    )
    .returning({ id: checkinMakeups.id })
  if (!updatedMakeup) throw new CheckinError("该补卡申请已由其他请求处理", 409)
  if (result === "APPROVED") {
    const makeupLocation = (makeup.location ?? {}) as {
      source?: string
      lat?: number
      lng?: number
      gpsExpiresAt?: string
      ip?: IpCoarseLocation
    }
    const isGps = makeupLocation.source === "GPS"
    const gpsStillValid =
      isGps &&
      typeof makeupLocation.lat === "number" &&
      typeof makeupLocation.lng === "number" &&
      (!makeupLocation.gpsExpiresAt ||
        new Date(makeupLocation.gpsExpiresAt) > now)
    const recordLocation = gpsStillValid
      ? makeupLocation
      : isGps
        ? {
            source: "GPS_PURGED",
            clearedAt: now.toISOString(),
            ...(makeupLocation.ip ? { ip: makeupLocation.ip } : {}),
          }
        : (makeup.location ?? {})
    await db
      .insert(checkinRecords)
      .values({
        taskId: makeup.taskId,
        userId: makeup.userId,
        checkinAt: now,
        status: "MAKEUP",
        slotIndex: makeup.slotIndex,
        makeupId: makeup.id,
        remark: comment?.trim() || "补卡审核通过",
        location: recordLocation,
        locationSource: gpsStillValid ? "GPS" : isGps ? "GPS_PURGED" : "IP",
        lat: gpsStillValid ? String(makeupLocation.lat) : null,
        lng: gpsStillValid ? String(makeupLocation.lng) : null,
        gpsExpiresAt: gpsStillValid
          ? makeupLocation.gpsExpiresAt
            ? new Date(makeupLocation.gpsExpiresAt)
            : getGpsExpiry(now)
          : null,
        ip: makeup.ip ?? null,
        clientType: "WEB",
      })
      .onConflictDoUpdate({
        target: checkinRecords.taskId,
        set: {
          status: "MAKEUP",
          makeupId: makeup.id,
          remark: comment?.trim() || "补卡审核通过",
          location: recordLocation,
          locationSource: gpsStillValid ? "GPS" : isGps ? "GPS_PURGED" : "IP",
          lat: gpsStillValid ? String(makeupLocation.lat) : null,
          lng: gpsStillValid ? String(makeupLocation.lng) : null,
        },
      })
    await db
      .update(checkinTasks)
      .set({ status: "MAKEUP_APPROVED", updatedAt: now })
      .where(eq(checkinTasks.id, makeup.taskId))
  } else {
    await db
      .update(checkinTasks)
      .set({ status: "MAKEUP_REJECTED", updatedAt: now })
      .where(eq(checkinTasks.id, makeup.taskId))
  }
}

export async function getCheckinReviewQueue(actor: SessionUser) {
  const ids = [...(await getSupervisedUserIdsForActor(actor))]
  if (!ids.length) return []
  return db
    .select({
      id: checkinMakeups.id,
      taskId: checkinMakeups.taskId,
      userId: checkinMakeups.userId,
      userName: users.name,
      ruleName: rules.name,
      reason: checkinMakeups.reason,
      status: checkinMakeups.status,
      date: checkinMakeups.date,
      slotIndex: checkinMakeups.slotIndex,
      createdAt: checkinMakeups.createdAt,
    })
    .from(checkinMakeups)
    .innerJoin(users, eq(users.id, checkinMakeups.userId))
    .innerJoin(rules, eq(rules.id, checkinMakeups.ruleId))
    .where(
      and(
        inArray(checkinMakeups.userId, ids),
        eq(checkinMakeups.status, "PENDING"),
      ),
    )
    .orderBy(desc(checkinMakeups.createdAt))
}
