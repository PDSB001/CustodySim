import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from "drizzle-orm"
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
 * 与 Web 端「服刑任务」的三档分类保持一致：
 * 待执行 = PENDING / RETURNED，待批阅 = SUBMITTED，执行记录 = 其余全部状态。
 */
const TASK_CATEGORIES = ["pending", "review", "history"] as const
type TaskCategory = (typeof TASK_CATEGORIES)[number]

function isTaskCategory(value: string | null): value is TaskCategory {
  return value !== null && (TASK_CATEGORIES as readonly string[]).includes(value)
}

function taskCategoryWhere(category: TaskCategory) {
  if (category === "pending")
    return inArray(reportTasks.status, ["PENDING", "RETURNED"])
  if (category === "review") return eq(reportTasks.status, "SUBMITTED")
  // 用"排除法"而不是枚举已通过/未通过/逾期/取消，将来新增状态会自动归入执行记录。
  return notInArray(reportTasks.status, ["PENDING", "RETURNED", "SUBMITTED"])
}

/**
 * 任务列表，可选分类与分页。
 *
 * 不传参数时保持旧行为（一次返回全部、按 scheduleAt 倒序），Web 端与 e2e 不受影响。
 *
 * 支持的可选参数：
 * - `category`：`pending` / `review` / `history`，与 Web 端筛选规则一致；带分类时改为
 *   按截止时间排序（待执行正序、其余倒序），游标相应变成 `deadline|id`。
 * - `limit`：单页条数，客户端滚到底再取下一页；不带 `category` 时游标为 `scheduleAt|id`。
 * - `counts=1`：只返回三个分类的条数，供客户端显示分类数字。
 */
export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    if (actor.role === "SUPERVISED") await ensureUserTasks(actor.id)
    const ids = [...(await getSupervisedUserIdsForActor(actor))]
    const params = request.nextUrl.searchParams
    if (!ids.length)
      return params.get("counts") === "1"
        ? success({ pending: 0, review: 0, history: 0 })
        : success([])

    const limitParam = params.get("limit")
    const limit =
      limitParam === null
        ? null
        : Math.min(
            Math.max(Number.parseInt(limitParam, 10) || 0, 1),
            MAX_PAGE_SIZE,
          )
    const categoryParam = params.get("category")
    const category = isTaskCategory(categoryParam) ? categoryParam : null

    // 分类计数：分类按钮上的数字，一次分组查询就够。
    if (params.get("counts") === "1") {
      const grouped = await db
        .select({ status: reportTasks.status, total: sql<number>`count(*)::int` })
        .from(reportTasks)
        .where(inArray(reportTasks.supervisedId, ids))
        .groupBy(reportTasks.status)
      const counts = { pending: 0, review: 0, history: 0 }
      for (const row of grouped) {
        const total = Number(row.total)
        if (row.status === "PENDING" || row.status === "RETURNED")
          counts.pending += total
        else if (row.status === "SUBMITTED") counts.review += total
        else counts.history += total
      }
      return success(counts)
    }

    const [cursorTime, cursorId] = (params.get("cursor") ?? "").split("|")
    const cursorDate = cursorTime ? new Date(cursorTime) : null
    const hasCursor =
      limit !== null &&
      cursorDate !== null &&
      !Number.isNaN(cursorDate.getTime()) &&
      UUID_PATTERN.test(cursorId ?? "")

    // 分类决定排序：待执行按截止时间正序（越急越靠前），待批阅/执行记录按倒序；
    // 不带 category 时沿用旧的 scheduleAt 倒序，Web 端与 e2e 行为不变。
    const ascending = category === "pending"
    const cursorColumn =
      category === null ? reportTasks.scheduleAt : reportTasks.deadline

    const filters = [inArray(reportTasks.supervisedId, ids)]
    if (category) filters.push(taskCategoryWhere(category))
    // 同一时间用 id 兜底，避免翻页时边界记录重复或漏掉。
    if (hasCursor && cursorDate)
      filters.push(
        or(
          ascending
            ? gt(cursorColumn, cursorDate)
            : lt(cursorColumn, cursorDate),
          and(
            eq(cursorColumn, cursorDate),
            ascending
              ? gt(reportTasks.id, sql`${cursorId}::uuid`)
              : lt(reportTasks.id, sql`${cursorId}::uuid`),
          ),
        )!,
      )

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
      .where(and(...filters))
      .orderBy(
        ...(category === null
          ? [desc(reportTasks.scheduleAt), desc(reportTasks.id)]
          : ascending
            ? [asc(reportTasks.deadline), asc(reportTasks.id)]
            : [desc(reportTasks.deadline), desc(reportTasks.id)]),
      )
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
