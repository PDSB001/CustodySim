import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  reportReviews,
  reportSubmissions,
  reportTasks,
  users,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"
import { applyTaskReview, ReviewConflictError } from "@/lib/task-review"

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ReviewSchema = z.object({
  submissionId: z.string().uuid(),
  result: z.enum(["APPROVED", "RETURNED"]),
  grade: z.coerce.number().int().min(0).max(100).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
})

/**
 * 批阅记录（历史）。
 *
 * 可见范围与 /api/tasks 保持一致：管理员为全部在押人员，监管员为其监管范围内，
 * 被监管人为本人。批阅记录本身是"一对多"（同一呈报经退回后重提会累计多条），
 * 这里按时间倒序全部返回，不做去重。
 */
export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)

  const params = request.nextUrl.searchParams
  const requested = Number(params.get("limit") ?? DEFAULT_PAGE_SIZE)
  const limit = Math.min(
    Math.max(
      Number.isFinite(requested) ? Math.trunc(requested) : DEFAULT_PAGE_SIZE,
      1,
    ),
    MAX_PAGE_SIZE,
  )

  // 游标为上一页最后一条的 createdAt|id，按 (createdAt, id) 降序翻页，避免翻页时重复或漏行。
  const [cursorTime, cursorId] = (params.get("cursor") ?? "").split("|")
  const cursorDate = cursorTime ? new Date(cursorTime) : null
  const hasCursor =
    cursorDate !== null &&
    !Number.isNaN(cursorDate.getTime()) &&
    UUID_PATTERN.test(cursorId ?? "")

  try {
    const ids = [...(await getSupervisedUserIdsForActor(actor))]
    if (!ids.length) return success({ items: [], nextCursor: null })

    const rows = await db
      .select({
        id: reportReviews.id,
        result: reportReviews.result,
        grade: reportReviews.grade,
        comment: reportReviews.comment,
        createdAt: reportReviews.createdAt,
        reviewerName: users.name,
        // 自动审核的 reviewerId 为 null（系统级身份），前端据此显示"AI 系统"
        automated: sql<boolean>`${reportReviews.reviewerId} is null`,
        taskId: reportTasks.id,
        taskTitle: reportTasks.title,
        supervisedName: sql<
          string | null
        >`(select ${users.name} from ${users} where ${users.id} = ${reportTasks.supervisedId})`,
      })
      .from(reportReviews)
      .innerJoin(
        reportSubmissions,
        eq(reportSubmissions.id, reportReviews.submissionId),
      )
      .innerJoin(reportTasks, eq(reportTasks.id, reportSubmissions.taskId))
      .leftJoin(users, eq(users.id, reportReviews.reviewerId))
      .where(
        hasCursor
          ? and(
              inArray(reportTasks.supervisedId, ids),
              or(
                lt(reportReviews.createdAt, cursorDate),
                and(
                  eq(reportReviews.createdAt, cursorDate),
                  lt(reportReviews.id, sql`${cursorId}::uuid`),
                ),
              ),
            )
          : inArray(reportTasks.supervisedId, ids),
      )
      .orderBy(desc(reportReviews.createdAt), desc(reportReviews.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items.at(-1)

    return success({
      items,
      nextCursor:
        hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    })
  } catch (error) {
    console.error("[API reviews GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "无审核权限", 403)
  const parsed = ReviewSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "审核参数不合法", 400)
  try {
    return success(await applyTaskReview(actor, parsed.data), { status: 201 })
  } catch (error) {
    if (error instanceof ReviewConflictError) {
      const forbidden = error.message === "不在监管范围内"
      return failure(
        forbidden ? "FORBIDDEN" : "CONFLICT",
        error.message || "任务已由其他请求处理",
        forbidden ? 403 : 409,
      )
    }
    console.error("[API reviews POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
