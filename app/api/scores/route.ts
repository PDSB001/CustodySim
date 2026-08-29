import { and, desc, eq, inArray } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  isolationOrders,
  persons,
  scoreEvents,
  scoreWeekReviews,
  users,
} from "@/lib/db/schema"
import { getShanghaiWeekKey, recordScoreEvent } from "@/lib/scoring"
import { getSessionUser } from "@/lib/session"
import {
  getSupervisedUserIdsForActor,
  isEffectiveSupervisorForSupervised,
} from "@/lib/supervision-scope"

const ManualScoreSchema = z.object({
  supervisedId: z.string().uuid(),
  points: z.coerce.number().int().min(-10).max(10).refine((value) => value !== 0),
  reason: z.string().trim().min(2).max(300),
})

function isWeekKey(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return getShanghaiWeekKey(new Date(`${value}T12:00:00+08:00`)) === value
}

function maskName(name: string) {
  if (name.length <= 1) return "*"
  return `${name.slice(0, 1)}${"*".repeat(Math.max(1, name.length - 1))}`
}

export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const ids =
      actor.role === "SUPERVISED"
        ? (
            await db
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  eq(users.role, "SUPERVISED"),
                  eq(users.status, "active"),
                ),
              )
          )
            .filter((user) => user.id)
            .map((user) => user.id)
        : [...(await getSupervisedUserIdsForActor(actor))]
    const now = new Date()
    const currentWeekKey = getShanghaiWeekKey(now)
    const requestedWeek = request.nextUrl.searchParams.get("week")
    const selectedWeek =
      isWeekKey(requestedWeek) && requestedWeek ? requestedWeek : currentWeekKey
    if (!ids.length)
      return success({
        selectedWeek,
        currentWeek: currentWeekKey,
        weeks: [currentWeekKey],
        people: [],
      })
    const [people, events, orders, reviews, actorProfile] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          organizationId: persons.organizationId,
        })
        .from(users)
        .leftJoin(
          persons,
          and(
            eq(persons.userId, users.id),
            eq(persons.personType, "SUPERVISED"),
          ),
        )
        .where(inArray(users.id, ids)),
      db
        .select({
          id: scoreEvents.id,
          supervisedId: scoreEvents.supervisedId,
          points: scoreEvents.points,
          reason: scoreEvents.reason,
          source: scoreEvents.source,
          weekKey: scoreEvents.weekKey,
          createdAt: scoreEvents.createdAt,
        })
        .from(scoreEvents)
        .where(inArray(scoreEvents.supervisedId, ids))
        .orderBy(desc(scoreEvents.createdAt)),
      db
        .select()
        .from(isolationOrders)
        .where(inArray(isolationOrders.supervisedId, ids)),
      db
        .select({
          supervisedId: scoreWeekReviews.supervisedId,
          weekKey: scoreWeekReviews.weekKey,
          result: scoreWeekReviews.result,
          totalScore: scoreWeekReviews.totalScore,
          evaluatedAt: scoreWeekReviews.evaluatedAt,
        })
        .from(scoreWeekReviews)
        .where(inArray(scoreWeekReviews.supervisedId, ids)),
      actor.role === "SUPERVISED"
        ? db
            .select({ organizationId: persons.organizationId })
            .from(persons)
            .where(
              and(
                eq(persons.userId, actor.id),
                eq(persons.personType, "SUPERVISED"),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ])
    const weeks = [...new Set([
      currentWeekKey,
      selectedWeek,
      ...events.map((event) => event.weekKey),
      ...reviews.map((review) => review.weekKey),
    ])].sort((left, right) => right.localeCompare(left))
    const actorRoomId = actorProfile[0]?.organizationId ?? null
    const ranking = people
      .map((person) => {
        const { name: rawName, ...personData } = person
        const ownEvents = events.filter((event) => event.supervisedId === person.id)
        const currentScore = ownEvents
          .filter((event) => event.weekKey === selectedWeek)
          .reduce((total, event) => total + event.points, 0)
        const activeIsolation = orders.find(
          (order) =>
            order.supervisedId === person.id &&
            order.status === "ACTIVE" &&
            order.endAt > now,
        )
        const isOwn = person.id === actor.id
        const sameRoom =
          actor.role === "SUPERVISED" &&
          Boolean(actorRoomId && person.organizationId === actorRoomId)
        const canSeeFullName = actor.role !== "SUPERVISED" || isOwn || sameRoom
        const weeklyReview = reviews.find(
          (review) =>
            review.supervisedId === person.id && review.weekKey === selectedWeek,
        )
        const actualName = rawName ?? "未命名"
        return {
          ...personData,
          name: canSeeFullName ? actualName : maskName(actualName),
          currentScore,
          activeIsolation: (actor.role !== "SUPERVISED" || isOwn || sameRoom) && activeIsolation
            ? {
                id: activeIsolation.id,
                triggerScore: activeIsolation.triggerScore,
                startAt: activeIsolation.startAt,
                endAt: activeIsolation.endAt,
            }
            : null,
          weeklyReview: weeklyReview
            ? {
                result: weeklyReview.result,
                totalScore: weeklyReview.totalScore,
                evaluatedAt: weeklyReview.evaluatedAt,
              }
            : null,
          events:
            actor.role !== "SUPERVISED" || isOwn
              ? ownEvents.filter((event) => event.weekKey === selectedWeek).slice(0, 8)
              : [],
        }
      })
      .sort(
        (left, right) =>
          right.currentScore - left.currentScore || left.name.localeCompare(right.name),
      )
    return success({
      selectedWeek,
      currentWeek: currentWeekKey,
      weeks,
      people: ranking,
    })
  } catch (error) {
    console.error("[API scores GET]", error)
    return failure("INTERNAL_ERROR", "读取积分计分板失败", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "仅管理人员可调整积分", 403)
  const parsed = ManualScoreSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "积分调整参数不合法", 400)
  if (!(await isEffectiveSupervisorForSupervised(actor, parsed.data.supervisedId)))
    return failure("FORBIDDEN", "不在监管范围内", 403)
  try {
    const event = await recordScoreEvent({
      supervisedId: parsed.data.supervisedId,
      points: parsed.data.points,
      reason: parsed.data.reason,
      source: "MANUAL",
      operatorId: actor.id,
    })
    if (!event) return failure("CONFLICT", "积分流水写入冲突，请重试", 409)
    await writeAuditLog({
      actor,
      action: "SCORE",
      actionLabel: parsed.data.points > 0 ? "手动加分" : "手动扣分",
      entityType: "score_event",
      entityId: event.id,
      detail: {
        supervisedId: parsed.data.supervisedId,
        points: parsed.data.points,
        reason: parsed.data.reason,
      },
    })
    return success(event, { status: 201 })
  } catch (error) {
    console.error("[API scores POST]", error)
    return failure("INTERNAL_ERROR", "保存积分流水失败", 500)
  }
}
