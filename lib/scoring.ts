import { and, eq, gt, gte, lt, lte } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  checkinDailyScores,
  checkinTasks,
  isolationOrders,
  isolationReflectionTasks,
  isolationSettings,
  persons,
  reportTasks,
  reportTemplateFields,
  reportTemplates,
  notices,
  scoreEvents,
  scoreWeekReviews,
  users,
} from "@/lib/db/schema"
import { getSupervisorIdsForSupervised } from "@/lib/supervision-scope"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"
import {
  ensureIsolationReportTemplate,
  ISOLATION_REPORT_TEMPLATE_NAME,
} from "@/lib/isolation-report-template"

export const SCORE_POLICY = {
  dailyCheckinBase: 5,
  dailyCheckinMissedPenalty: 2,
  dailyCheckinMakeupPenalty: 1,
  dailyCheckinNoCheckinPenalty: -8,
  taskFirstPass: 2,
  taskReturnedThenPass: 1,
  taskExpired: -2,
  isolationThreshold: 0,
  isolationDurationDays: 3,
} as const

export function getShanghaiWeekKey(now = new Date()) {
  const [year, month, day] = getShanghaiDateKey(now).split("-").map(Number)
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day))
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

export function getDailyCheckinScore({
  normalCheckinCount,
  makeupCount,
  missingCount,
}: {
  normalCheckinCount: number
  makeupCount: number
  missingCount: number
}) {
  if (normalCheckinCount === 0)
    return SCORE_POLICY.dailyCheckinNoCheckinPenalty
  return Math.max(
    0,
    SCORE_POLICY.dailyCheckinBase -
      missingCount * SCORE_POLICY.dailyCheckinMissedPenalty -
      makeupCount * SCORE_POLICY.dailyCheckinMakeupPenalty,
  )
}

function shiftWeekKey(weekKey: string, weeks: number) {
  const date = new Date(`${weekKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + weeks * 7)
  return date.toISOString().slice(0, 10)
}

function isShanghaiMonday(now = new Date()) {
  const [year, month, day] = getShanghaiDateKey(now).split("-").map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, day)).getUTCDay() === 1
}

export function getTaskOutcomeScoreDelta({
  returnedBeforeApproval,
}: {
  returnedBeforeApproval: boolean
}) {
  return returnedBeforeApproval
    ? SCORE_POLICY.taskReturnedThenPass
    : SCORE_POLICY.taskFirstPass
}

export async function recordScoreEvent({
  supervisedId,
  points,
  reason,
  source,
  sourceId = null,
  operatorId = null,
  now = new Date(),
  weekKey,
}: {
  supervisedId: string
  points: number
  reason: string
  source: string
  sourceId?: string | null
  operatorId?: string | null
  now?: Date
  weekKey?: string
}) {
  if (!Number.isInteger(points) || points === 0)
    throw new Error("积分变动必须是非零整数")
  const [event] = await db
    .insert(scoreEvents)
    .values({
      supervisedId,
      points,
      reason,
      source,
      sourceId,
      operatorId,
      weekKey: weekKey ?? getShanghaiWeekKey(now),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning()
  return event ?? null
}

function getShanghaiDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00+08:00`)
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  }
}

async function settleCheckinDailyScore(
  supervisedId: string,
  dayKey: string,
  now: Date,
) {
  const { start, end } = getShanghaiDayRange(dayKey)
  const tasks = await db
    .select({ id: checkinTasks.id, status: checkinTasks.status })
    .from(checkinTasks)
    .where(
      and(
        eq(checkinTasks.supervisedId, supervisedId),
        gte(checkinTasks.scheduleAt, start),
        lt(checkinTasks.scheduleAt, end),
      ),
    )
  const scoredTasks = tasks.filter((task) => task.status !== "SYSTEM_MAKEUP")
  if (!scoredTasks.length) return null
  const normalCheckinCount = scoredTasks.filter((task) =>
    ["COMPLETED", "LATE"].includes(task.status),
  ).length
  const makeupCount = scoredTasks.filter(
    (task) => task.status === "MAKEUP_APPROVED",
  ).length
  const missingCount = scoredTasks.filter((task) =>
    ["MISSED", "MAKEUP_PENDING", "MAKEUP_REJECTED", "PENDING"].includes(
      task.status,
    ),
  ).length
  const points = getDailyCheckinScore({
    normalCheckinCount,
    makeupCount,
    missingCount,
  })
  const reason =
    normalCheckinCount === 0
      ? `${dayKey} 全天未打卡`
      : `${dayKey} 打卡日结：补卡 ${makeupCount} 次，缺卡 ${missingCount} 次`
  const weekKey = getShanghaiWeekKey(new Date(`${dayKey}T12:00:00+08:00`))
  const [existing] = await db
    .select()
    .from(checkinDailyScores)
    .where(
      and(
        eq(checkinDailyScores.supervisedId, supervisedId),
        eq(checkinDailyScores.dayKey, dayKey),
      ),
    )
    .limit(1)
  if (
    existing &&
    existing.scheduledCount === scoredTasks.length &&
    existing.completedCount === normalCheckinCount &&
    existing.makeupCount === makeupCount &&
    existing.missingCount === missingCount &&
    existing.points === points
  )
    return existing
  return db.transaction(async (tx) => {
    const [dailyScore] = existing
      ? await tx
          .update(checkinDailyScores)
          .set({
            scheduledCount: scoredTasks.length,
            completedCount: normalCheckinCount,
            makeupCount,
            missingCount,
            points,
            settledAt: now,
            updatedAt: now,
          })
          .where(eq(checkinDailyScores.id, existing.id))
          .returning()
      : await tx
          .insert(checkinDailyScores)
          .values({
            supervisedId,
            dayKey,
            scheduledCount: scoredTasks.length,
            completedCount: normalCheckinCount,
            makeupCount,
            missingCount,
            points,
            settledAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning()
    if (!dailyScore) return null
    const [scoreEvent] = dailyScore.scoreEventId
      ? await tx
          .update(scoreEvents)
          .set({ points, reason, weekKey })
          .where(eq(scoreEvents.id, dailyScore.scoreEventId))
          .returning({ id: scoreEvents.id })
      : await tx
          .insert(scoreEvents)
          .values({
            supervisedId,
            points,
            reason,
            source: "CHECKIN_DAILY",
            sourceId: dailyScore.id,
            weekKey,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: scoreEvents.id })
    if (!scoreEvent) return dailyScore
    if (!dailyScore.scoreEventId)
      await tx
        .update(checkinDailyScores)
        .set({ scoreEventId: scoreEvent.id, updatedAt: now })
        .where(eq(checkinDailyScores.id, dailyScore.id))
    return dailyScore
  })
}

export async function runCheckinDailyScoreSweep(now = new Date()) {
  const todayStart = getShanghaiDayRange(getShanghaiDateKey(now)).start
  const candidates = await db
    .select({
      supervisedId: checkinTasks.supervisedId,
      scheduleAt: checkinTasks.scheduleAt,
    })
    .from(checkinTasks)
    .where(lt(checkinTasks.scheduleAt, todayStart))
  const pendingSettlements = new Map<string, { supervisedId: string; dayKey: string }>()
  for (const task of candidates) {
    const dayKey = getShanghaiDateKey(task.scheduleAt)
    pendingSettlements.set(`${task.supervisedId}:${dayKey}`, {
      supervisedId: task.supervisedId,
      dayKey,
    })
  }
  let settled = 0
  for (const candidate of pendingSettlements.values()) {
    if (await settleCheckinDailyScore(candidate.supervisedId, candidate.dayKey, now))
      settled += 1
  }
  return settled
}

export async function getActiveIsolationOrder(
  supervisedId: string,
  now = new Date(),
) {
  const [order] = await db
    .select()
    .from(isolationOrders)
    .where(
      and(
        eq(isolationOrders.supervisedId, supervisedId),
        eq(isolationOrders.status, "ACTIVE"),
        gt(isolationOrders.endAt, now),
      ),
    )
    .limit(1)
  return order ?? null
}

export async function runWeeklyScoreReview(now = new Date()) {
  if (!isShanghaiMonday(now)) return 0
  await runCheckinDailyScoreSweep(now)
  const completedWeekKey = shiftWeekKey(getShanghaiWeekKey(now), -1)
  const weekStartAt = new Date(`${getShanghaiWeekKey(now)}T00:00:00+08:00`)
  const supervisedUsers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "SUPERVISED"), eq(users.status, "active")))
  let evaluated = 0
  for (const user of supervisedUsers) {
    const [existing] = await db
      .select({ id: scoreWeekReviews.id })
      .from(scoreWeekReviews)
      .where(
        and(
          eq(scoreWeekReviews.supervisedId, user.id),
          eq(scoreWeekReviews.weekKey, completedWeekKey),
        ),
      )
      .limit(1)
    if (existing) continue
    const events = await db
      .select({ points: scoreEvents.points })
      .from(scoreEvents)
      .where(
        and(
          eq(scoreEvents.supervisedId, user.id),
          eq(scoreEvents.weekKey, completedWeekKey),
        ),
      )
    const totalScore = events.reduce((total, event) => total + event.points, 0)
    const result = totalScore < SCORE_POLICY.isolationThreshold ? "ISOLATION" : "CLEAR"
    const [review] = await db
      .insert(scoreWeekReviews)
      .values({
        supervisedId: user.id,
        weekKey: completedWeekKey,
        totalScore,
        result,
        evaluatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: scoreWeekReviews.id })
    if (!review) continue
    evaluated += 1
    if (result !== "ISOLATION") continue
    const [profile] = await db
      .select({ custodyStatus: persons.custodyStatus })
      .from(persons)
      .where(eq(persons.userId, user.id))
      .limit(1)
    const previousCustodyStatus = profile?.custodyStatus ?? "IN_CUSTODY"
    const order = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(isolationOrders)
        .values({
          supervisedId: user.id,
          weekKey: completedWeekKey,
          triggerScore: totalScore,
          previousCustodyStatus,
          startAt: weekStartAt,
          endAt: new Date(
            weekStartAt.getTime() +
              SCORE_POLICY.isolationDurationDays * 24 * 60 * 60 * 1000,
          ),
        })
        .onConflictDoNothing()
        .returning()
      if (!created) return null
      await tx
        .update(persons)
        .set({ custodyStatus: "ISOLATION", updatedAt: now })
        .where(eq(persons.userId, user.id))
      return created
    })
    if (order) await ensureIsolationReflectionTask(order, now)
    if (order) {
      await db.insert(notices).values({
        title: "禁闭公示",
        content: `${user.name} 已于每周一 00:00 进入禁闭室，禁闭至 ${order.endAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。`,
        targetRole: "ALL",
        priority: "IMPORTANT",
        published: true,
        publishedAt: now,
      })
    }
  }
  return evaluated
}

type IsolationTemplateSnapshot = {
  name: string
  kind: string
  content: string
  fields: Array<{ name: string; type: string; required: boolean; options: unknown[] }>
}

const reflectionTemplateSnapshot: IsolationTemplateSnapshot = {
  name: "禁闭期间每日检讨",
  kind: "REPORT",
  content: "请如实复盘当日行为，说明问题、影响与次日具体改进计划。审核通过后将向全体发布。",
  fields: [
    { name: "当日检讨", type: "TEXTAREA", required: true, options: [] },
    { name: "改进计划", type: "TEXTAREA", required: true, options: [] },
  ],
}

export async function ensureIsolationReflectionTask(
  order: typeof isolationOrders.$inferSelect,
  now = new Date(),
) {
  if (order.status !== "ACTIVE" || order.endAt <= now) return null
  const dayKey = getShanghaiDateKey(now)
  const [settings] = await db
    .select()
    .from(isolationSettings)
    .where(eq(isolationSettings.id, "default"))
    .limit(1)
  const configuredTemplateIds = Array.isArray(settings?.templateIds) && settings.templateIds.length
    ? settings.templateIds.filter((id): id is string => typeof id === "string")
    : [settings?.templateId ?? (await ensureIsolationReportTemplate()).id]
  const supervisors = await getSupervisorIdsForSupervised(order.supervisedId)
  let firstTaskId: string | null = null
  for (const configuredTemplateId of configuredTemplateIds) {
    const templateKey = configuredTemplateId
    const [existing] = await db.select({ taskId: isolationReflectionTasks.taskId }).from(isolationReflectionTasks).where(and(eq(isolationReflectionTasks.isolationOrderId, order.id), eq(isolationReflectionTasks.dayKey, dayKey), eq(isolationReflectionTasks.templateKey, templateKey))).limit(1)
    if (existing) {
      firstTaskId ??= existing.taskId
      continue
    }
    let templateSnapshot = reflectionTemplateSnapshot
    let title = reflectionTemplateSnapshot.name
    const [template] = await db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.id, configuredTemplateId))
      .limit(1)
    if (template) {
      const fields = await db
        .select()
        .from(reportTemplateFields)
        .where(eq(reportTemplateFields.templateId, template.id))
      title = template.name
      templateSnapshot = {
        name: template.name,
        kind: template.kind,
        content: template.content ?? "",
        fields: fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
          options: Array.isArray(field.options) ? field.options : [],
        })),
      }
    }
    const scheduleTime = settings?.scheduleTime ?? "19:00"
    const scheduleAt = new Date(`${dayKey}T${scheduleTime}:00+08:00`)
    const deadline = new Date(scheduleAt.getTime() + (settings?.timeoutMinutes ?? 240) * 60_000)
    const [task] = await db
    .insert(reportTasks)
    .values({
      title,
      supervisedId: order.supervisedId,
      supervisorId: [...supervisors][0] ?? null,
      templateSnapshot,
      payload: {
        isolationOrderId: order.id,
        dayKey,
        isReflection: title === ISOLATION_REPORT_TEMPLATE_NAME,
      },
      source: "ISOLATION",
      scheduleAt,
      deadline,
      })
      .returning({ id: reportTasks.id })
    if (!task) continue
    const [link] = await db
    .insert(isolationReflectionTasks)
      .values({ isolationOrderId: order.id, taskId: task.id, dayKey, templateKey })
    .onConflictDoNothing()
    .returning({ taskId: isolationReflectionTasks.taskId })
    firstTaskId ??= link?.taskId ?? null
  }
  return firstTaskId
}

export async function runIsolationSweep(now = new Date()) {
  await runWeeklyScoreReview(now)
  const expiredOrders = await db
    .select()
    .from(isolationOrders)
    .where(
      and(eq(isolationOrders.status, "ACTIVE"), lte(isolationOrders.endAt, now)),
    )
  for (const expiredOrder of expiredOrders) {
    await db.transaction(async (tx) => {
      const [completed] = await tx
        .update(isolationOrders)
        .set({ status: "COMPLETED", updatedAt: now })
        .where(
          and(
            eq(isolationOrders.id, expiredOrder.id),
            eq(isolationOrders.status, "ACTIVE"),
          ),
        )
        .returning({ id: isolationOrders.id })
      if (!completed) return
      await tx
        .update(persons)
        .set({
          custodyStatus: expiredOrder.previousCustodyStatus,
          updatedAt: now,
        })
        .where(
          and(
            eq(persons.userId, expiredOrder.supervisedId),
            eq(persons.custodyStatus, "ISOLATION"),
          ),
        )
    })
  }
  const activeOrders = await db
    .select()
    .from(isolationOrders)
    .where(and(eq(isolationOrders.status, "ACTIVE"), gt(isolationOrders.endAt, now)))
  for (const order of activeOrders) await ensureIsolationReflectionTask(order, now)
  return activeOrders.length
}

const schedulerKey = Symbol.for("custodysim.isolation-scheduler")

export function startIsolationScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [schedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[schedulerKey]) return
  const run = () =>
    void runIsolationSweep().catch((error: unknown) =>
      console.error("[isolation] scheduled sweep failed", error),
    )
  run()
  const timer = setInterval(run, 15 * 60 * 1000)
  timer.unref?.()
  runtime[schedulerKey] = timer
}
