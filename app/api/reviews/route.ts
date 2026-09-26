import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm"
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

  // 筛选：按人（supervisedId）、按时间范围（createdAt，from 含 / to 不含）、按是否自动审核。
  const requestedUser = params.get("userId") ?? ""
  const userFilter = UUID_PATTERN.test(requestedUser) ? requestedUser : null
  const parseDate = (value: string | null) => {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const fromFilter = parseDate(params.get("from"))
  const toFilter = parseDate(params.get("to"))
  const automatedFilter = params.get("automated")

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
        supervisedId: reportTasks.supervisedId,
        supervisedName: sql<
          string | null
        >`(select ${users.name} from ${users} where ${users.id} = ${reportTasks.supervisedId})`,
        // 当次被审的提交内容：优先用审核时冻结的快照（A5 起写入），
        // 老记录没有快照时回退到当前提交，并在响应里用 snapshotMissing 标注，
        // 由界面提示"该记录早于快照上线，显示的是最新提交版本"。
        submittedSnapshot: reportReviews.submittedSnapshot,
        submissionData: reportSubmissions.data,
        submissionContent: reportSubmissions.content,
        // 任务侧模板快照：老记录没有批阅快照时用它兜底补出"当时该填哪些字段"。
        // 少了它，兜底数据（data）有内容、字段定义却是空的，界面只会显示
        // "本项任务的填写内容尚未配置" —— 看着像没数据，其实是字段没给。
        taskTemplateSnapshot: reportTasks.templateSnapshot,
      })
      .from(reportReviews)
      .innerJoin(
        reportSubmissions,
        eq(reportSubmissions.id, reportReviews.submissionId),
      )
      .innerJoin(reportTasks, eq(reportTasks.id, reportSubmissions.taskId))
      .leftJoin(users, eq(users.id, reportReviews.reviewerId))
      .where(
        and(
          inArray(reportTasks.supervisedId, ids),
          userFilter ? eq(reportTasks.supervisedId, userFilter) : undefined,
          fromFilter ? gte(reportReviews.createdAt, fromFilter) : undefined,
          toFilter ? lt(reportReviews.createdAt, toFilter) : undefined,
          automatedFilter === "1"
            ? isNull(reportReviews.reviewerId)
            : automatedFilter === "0"
              ? isNotNull(reportReviews.reviewerId)
              : undefined,
          hasCursor
            ? or(
                lt(reportReviews.createdAt, cursorDate),
                and(
                  eq(reportReviews.createdAt, cursorDate),
                  lt(reportReviews.id, sql`${cursorId}::uuid`),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(reportReviews.createdAt), desc(reportReviews.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...row,
      // 快照缺失（A5 之前的历史记录）时，界面上要如实标注，别让人以为是当时原文。
      snapshotMissing: row.submittedSnapshot === null,
      submittedSnapshot: row.submittedSnapshot ?? {
        data: row.submissionData,
        content: row.submissionContent,
        // 老记录只能拿任务当前的模板定义兜底：与上面的 data 一样"未必与当时一致"，
        // 界面已经用 snapshotMissing 明确提示过这一点。
        templateSnapshot: row.taskTemplateSnapshot,
        submissionUpdatedAt: null,
      },
      submissionData: undefined,
      submissionContent: undefined,
      taskTemplateSnapshot: undefined,
    }))
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
