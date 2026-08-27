import { eq } from "drizzle-orm"
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
  const taskKind =
    typeof row.templateSnapshot === "object" && row.templateSnapshot
      ? (row.templateSnapshot as { kind?: string }).kind
      : undefined
  const officialSealData =
    parsed.data.result === "APPROVED"
      ? await getOfficialSealData(taskKind === "REPORT" ? "REPORT" : "TASK")
      : null
  const [review] = await db
    .insert(reportReviews)
    .values({
      ...parsed.data,
      reviewerId: actor.id,
      submissionId: parsed.data.submissionId,
    })
    .returning()
  await db
    .update(reportTasks)
    .set({
      status: parsed.data.result === "APPROVED" ? "APPROVED" : "RETURNED",
      updatedAt: new Date(),
    })
    .where(eq(reportTasks.id, row.taskId))
  if (officialSealData)
    await db
      .update(reportSubmissions)
      .set({ officialSealData, updatedAt: new Date() })
      .where(eq(reportSubmissions.id, parsed.data.submissionId))
  if (!review) return failure("INTERNAL_ERROR", "审核失败", 500)
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