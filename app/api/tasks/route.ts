import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  autoReviewRuns,
  reportReviews,
  reportSubmissions,
  reportTasks,
  users,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"
import { ensureUserTasks } from "@/lib/task-engine"
import {
  getAutoReviewSettings,
  isMissingAutoReviewTable,
} from "@/lib/auto-review-settings"

/** 单页上限，避免客户端用超大 limit 把整表拉回来。 */
const MAX_PAGE_SIZE = 100
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 任务列表，可选分页。
 *
 * 不传 `limit` 时保持旧行为（一次返回全部），Web 端与 e2e 不受影响；
 * 传了则按 (scheduleAt, id) 倒序做游标分页，客户端滚到底再取下一页。
 * 游标格式为 `scheduleAt|id`，由客户端用上一页最后一条拼出。
 */
export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    if (actor.role === "SUPERVISED") await ensureUserTasks(actor.id)
    const ids = [...(await getSupervisedUserIdsForActor(actor))]
    if (!ids.length) return success([])

    const params = request.nextUrl.searchParams
    const limitParam = params.get("limit")
    const limit =
      limitParam === null
        ? null
        : Math.min(
            Math.max(Number.parseInt(limitParam, 10) || 0, 1),
            MAX_PAGE_SIZE,
          )
    const [cursorTime, cursorId] = (params.get("cursor") ?? "").split("|")
    const cursorDate = cursorTime ? new Date(cursorTime) : null
    const hasCursor =
      limit !== null &&
      cursorDate !== null &&
      !Number.isNaN(cursorDate.getTime()) &&
      UUID_PATTERN.test(cursorId ?? "")

    // 同一 scheduleAt 用 id 兜底，避免翻页时边界记录重复或漏掉。
    const where =
      hasCursor && cursorDate
        ? and(
            inArray(reportTasks.supervisedId, ids),
            or(
              lt(reportTasks.scheduleAt, cursorDate),
              and(
                eq(reportTasks.scheduleAt, cursorDate),
                lt(reportTasks.id, sql`${cursorId}::uuid`),
              ),
            ),
          )
        : inArray(reportTasks.supervisedId, ids)

    const base = db
      .select({
        id: reportTasks.id,
        title: reportTasks.title,
        supervisedId: reportTasks.supervisedId,
        supervisedName: users.name,
        scheduleAt: reportTasks.scheduleAt,
        deadline: reportTasks.deadline,
        status: reportTasks.status,
        templateSnapshot: reportTasks.templateSnapshot,
        submissionId: reportSubmissions.id,
        content: reportSubmissions.content,
        data: reportSubmissions.data,
        submissionStatus: reportSubmissions.status,
        officialSealData: reportSubmissions.officialSealData,
        reviewComment: sql<
          string | null
        >`(select ${reportReviews.comment} from ${reportReviews} where ${reportReviews.submissionId} = ${reportSubmissions.id} order by ${reportReviews.createdAt} desc limit 1)`,
        // 被监管人查看已办结任务时需要展示批阅时间与评分（取最新一条批阅）
        reviewGrade: sql<
          number | null
        >`(select ${reportReviews.grade} from ${reportReviews} where ${reportReviews.submissionId} = ${reportSubmissions.id} order by ${reportReviews.createdAt} desc limit 1)`,
        reviewedAt: sql<
          Date | null
        >`(select ${reportReviews.createdAt} from ${reportReviews} where ${reportReviews.submissionId} = ${reportSubmissions.id} order by ${reportReviews.createdAt} desc limit 1)`,
        inputVersion: sql<string>`${reportTasks.updatedAt}::text || '/' || ${reportSubmissions.updatedAt}::text`,
      })
      .from(reportTasks)
      .leftJoin(reportSubmissions, eq(reportSubmissions.taskId, reportTasks.id))
      .leftJoin(users, eq(users.id, reportTasks.supervisedId))
      .where(where)
      .orderBy(desc(reportTasks.scheduleAt), desc(reportTasks.id))
      .$dynamic()
    const rows = await (limit === null ? base : base.limit(limit))
    const submissionIds = rows.flatMap((row) =>
      row.submissionId ? [row.submissionId] : [],
    )
    const autoRuns =
      (await getAutoReviewSettings()).storageReady && submissionIds.length
        ? await db
            .select()
            .from(autoReviewRuns)
            .where(inArray(autoReviewRuns.submissionId, submissionIds))
            .orderBy(desc(autoReviewRuns.createdAt))
            .catch((error: unknown) => {
              if (isMissingAutoReviewTable(error)) return []
              throw error
            })
        : []
    return success(
      rows.map(({ inputVersion, ...row }) => ({
        ...row,
        autoReviewReason:
          row.status === "SUBMITTED"
            ? (autoRuns.find(
                (run) =>
                  run.submissionId === row.submissionId &&
                  run.inputVersion === inputVersion,
              )?.reason ?? null)
            : null,
      })),
    )
  } catch (error) {
    console.error("[API tasks GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
