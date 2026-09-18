import { desc, eq, inArray, sql } from "drizzle-orm"

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

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    if (actor.role === "SUPERVISED") await ensureUserTasks(actor.id)
    const ids = [...(await getSupervisedUserIdsForActor(actor))]
    if (!ids.length) return success([])
    const rows = await db
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
      .where(inArray(reportTasks.supervisedId, ids))
      .orderBy(desc(reportTasks.scheduleAt))
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
