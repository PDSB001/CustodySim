import { and, eq, gte, lt, lte, sql, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  readingTicks,
  reportTasks,
  libraryScoreSettings,
  scoreEvents,
  users,
} from "@/lib/db/schema"
import {
  recordScoreEvent,
  SCORE_POLICY,
  getTaskOutcomeWeekKey,
} from "@/lib/scoring"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"
import { readingPoints } from "@/lib/library"

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function settleReadingTasks(
  tx: Executor,
  userId: string,
  now = new Date(),
) {
  const tasks = await tx
    .select()
    .from(reportTasks)
    .where(
      and(
        eq(reportTasks.supervisedId, userId),
        inArray(reportTasks.status, ["PENDING", "RETURNED"]),
        lte(reportTasks.scheduleAt, now),
        sql`${reportTasks.templateSnapshot}->>'completionMode' = 'READING'`,
      ),
    )
    .orderBy(reportTasks.id)
    .for("update")
  let approved = 0
  for (const task of tasks) {
    const snapshot = task.templateSnapshot as { readingMinutes?: number }
    if (!snapshot.readingMinutes || snapshot.readingMinutes <= 0) continue
    const [duration] = await tx
      .select({
        seconds: sql<number>`coalesce(sum(${readingTicks.seconds}), 0)::int`,
      })
      .from(readingTicks)
      .where(
        and(
          eq(readingTicks.userId, userId),
          gte(readingTicks.startedAt, task.scheduleAt),
          lte(
            readingTicks.endedAt,
            new Date(Math.min(now.getTime(), task.deadline.getTime())),
          ),
        ),
      )
    if (duration.seconds < snapshot.readingMinutes * 60) continue
    await tx
      .update(reportTasks)
      .set({ status: "APPROVED", updatedAt: now })
      .where(eq(reportTasks.id, task.id))
    await recordScoreEvent({
      supervisedId: userId,
      points:
        task.status === "RETURNED"
          ? SCORE_POLICY.taskReturnedThenPass
          : SCORE_POLICY.taskFirstPass,
      reason: `阅读达到 ${snapshot.readingMinutes} 分钟，学习任务自动通过`,
      source: "TASK_OUTCOME",
      sourceId: task.id,
      now,
      weekKey: getTaskOutcomeWeekKey(task.scheduleAt),
      executor: tx,
    })
    approved++
  }
  return approved
}

export async function reconcileReadingTasks(userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
    return settleReadingTasks(tx, userId, now)
  })
}

export async function settleReadingPoints(
  tx: Executor,
  userId: string,
  sourceId: string,
  now: Date,
) {
  const [settings] = await tx
    .select()
    .from(libraryScoreSettings)
    .where(eq(libraryScoreSettings.id, 1))
  const policy = settings ?? { enabled: true, minutesPerPoint: 15, dailyCap: 3 }
  if (!policy.enabled) return 0
  const start = new Date(`${getShanghaiDateKey(now)}T00:00:00+08:00`)
  const end = new Date(start.getTime() + 86400000)
  const [duration] = await tx
    .select({
      seconds: sql<number>`coalesce(sum(${readingTicks.seconds}), 0)::int`,
    })
    .from(readingTicks)
    .where(
      and(
        eq(readingTicks.userId, userId),
        gte(readingTicks.endedAt, start),
        lt(readingTicks.endedAt, end),
      ),
    )
  const [awarded] = await tx
    .select({
      points: sql<number>`coalesce(sum(${scoreEvents.points}), 0)::int`,
    })
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.supervisedId, userId),
        eq(scoreEvents.source, "READING_DURATION"),
        gte(scoreEvents.createdAt, start),
        lt(scoreEvents.createdAt, end),
      ),
    )
  const points = Math.max(
    0,
    readingPoints(duration.seconds, policy.minutesPerPoint, policy.dailyCap) -
      awarded.points,
  )
  if (points)
    await recordScoreEvent({
      supervisedId: userId,
      points,
      source: "READING_DURATION",
      sourceId,
      reason: `图书馆阅读积分：每 ${policy.minutesPerPoint} 分钟 1 分`,
      now,
      executor: tx,
    })
  return points
}

export async function taskReadingSeconds(
  userId: string,
  start: Date,
  end: Date,
) {
  const [row] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${readingTicks.seconds}), 0)::int`,
    })
    .from(readingTicks)
    .where(
      and(
        eq(readingTicks.userId, userId),
        gte(readingTicks.startedAt, start),
        lte(readingTicks.endedAt, end),
      ),
    )
  return row?.seconds ?? 0
}
