import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { reportReviews, reportSubmissions, reportTasks } from "@/lib/db/schema"
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
    .select({ taskId: reportTasks.id, supervisedId: reportTasks.supervisedId })
    .from(reportSubmissions)
    .innerJoin(reportTasks, eq(reportTasks.id, reportSubmissions.taskId))
    .where(eq(reportSubmissions.id, parsed.data.submissionId))
    .limit(1)
  if (
    !row ||
    !(await isEffectiveSupervisorForSupervised(actor, row.supervisedId))
  )
    return failure("FORBIDDEN", "不在监管范围内", 403)
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
  return review
    ? success(review, { status: 201 })
    : failure("INTERNAL_ERROR", "审核失败", 500)
}
