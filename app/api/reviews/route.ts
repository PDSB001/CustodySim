import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { reportReviews, reportSubmissions, reportTasks } from "@/lib/db/schema"
import { getOfficialSealData } from "@/lib/seal-server"
import { getSessionUser } from "@/lib/session"
import { isEffectiveSupervisorForSupervised } from "@/lib/supervision-scope"

const ReviewSchema = z.object({
  submissionId: z.string().uuid(),
  result: z.enum(["APPROVED", "RETURNED"]),
  grade: z.coerce.number().int().min(0).max(100).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
})

class ReviewConflictError extends Error {}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "无审核权限", 403)
  const parsed = ReviewSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "审核参数不合法", 400)
  const [row] = await db
    .select({
      taskId: reportTasks.id,
      supervisedId: reportTasks.supervisedId,
      templateSnapshot: reportTasks.templateSnapshot,
      taskStatus: reportTasks.status,
    })
    .from(reportSubmissions)
    .innerJoin(reportTasks, eq(reportTasks.id, reportSubmissions.taskId))
    .where(eq(reportSubmissions.id, parsed.data.submissionId))
    .limit(1)
  if (
    !row ||
    !(await isEffectiveSupervisorForSupervised(actor, row.supervisedId))
  )
    return failure("FORBIDDEN", "不在监管范围内", 403)
  if (row.taskStatus !== "SUBMITTED")
    return failure("CONFLICT", "任务当前不可审核", 409)
  const taskKind =
    typeof row.templateSnapshot === "object" && row.templateSnapshot
      ? (row.templateSnapshot as { kind?: string }).kind
      : undefined
  const officialSealData =
    parsed.data.result === "APPROVED"
      ? await getOfficialSealData(taskKind === "REPORT" ? "REPORT" : "TASK")
      : null
  let review
  try {
    review = await db.transaction(async (tx) => {
      const now = new Date()
      const [updatedTask] = await tx
        .update(reportTasks)
        .set({
          status: parsed.data.result === "APPROVED" ? "APPROVED" : "RETURNED",
          updatedAt: now,
        })
        .where(
          and(
            eq(reportTasks.id, row.taskId),
            eq(reportTasks.status, "SUBMITTED"),
          ),
        )
        .returning({ id: reportTasks.id })
      if (!updatedTask) throw new ReviewConflictError()
      const [createdReview] = await tx
        .insert(reportReviews)
        .values({
          ...parsed.data,
          reviewerId: actor.id,
          submissionId: parsed.data.submissionId,
        })
        .returning()
      if (!createdReview) throw new Error("审核记录创建失败")
      if (officialSealData)
        await tx
          .update(reportSubmissions)
          .set({ officialSealData, updatedAt: now })
          .where(eq(reportSubmissions.id, parsed.data.submissionId))
      return createdReview
    })
  } catch (error) {
    if (error instanceof ReviewConflictError)
      return failure("CONFLICT", "任务已由其他请求处理", 409)
    throw error
  }
  await writeAuditLog({
    actor,
    action: "REVIEW",
    actionLabel: parsed.data.result === "APPROVED" ? "审核通过任务" : "退回任务",
    entityType: "report_submission",
    entityId: parsed.data.submissionId,
    detail: { result: parsed.data.result, grade: parsed.data.grade ?? null },
  })
  return success(review, { status: 201 })
}
