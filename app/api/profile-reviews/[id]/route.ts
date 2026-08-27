import { and, asc, eq, gt } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { ProfileReviewSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { profileRecordReviews, profileRecords } from "@/lib/db/schema"
import { generateProfileRecordCode } from "@/lib/numbering-server"
import { resolveProfileReviewTransition } from "@/lib/profile-record"
import { getSessionUser } from "@/lib/session"
import { getOfficialSealData } from "@/lib/seal-server"

const ParamsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN")
    return failure("FORBIDDEN", "仅监管人或管理处可处理档案审核", 403)
  const [params, parsed] = await Promise.all([
    context.params.then((value) => ParamsSchema.safeParse(value)),
    request
      .json()
      .then((value: unknown) => ProfileReviewSchema.safeParse(value)),
  ])
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "会签参数不合法", 400)
  try {
    const [review] = await db
      .select()
      .from(profileRecordReviews)
      .where(
        and(
          eq(profileRecordReviews.id, params.data.id),
          eq(profileRecordReviews.reviewerId, actor.id),
        ),
      )
      .limit(1)
    if (!review) return failure("NOT_FOUND", "待处理会签不存在", 404)
    if (review.result !== "PENDING")
      return failure("CONFLICT", "该会签尚未轮到你处理或已完成", 409)

    const [record] = await db
      .select()
      .from(profileRecords)
      .where(eq(profileRecords.id, review.recordId))
      .limit(1)
    if (!record || record.status !== "PENDING_REVIEW")
      return failure("CONFLICT", "档案当前不在会签流程中", 409)

    const [updatedReview] = await db
      .update(profileRecordReviews)
      .set({
        result: parsed.data.result,
        grade: parsed.data.grade ?? null,
        comment: parsed.data.comment ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(profileRecordReviews.id, review.id))
      .returning()
    if (!updatedReview) return failure("INTERNAL_ERROR", "保存会签失败", 500)

    if (parsed.data.result === "RETURNED") {
      await db
        .update(profileRecords)
        .set({ status: "RETURNED", updatedAt: new Date() })
        .where(eq(profileRecords.id, record.id))
    } else {
      const [nextReview] = await db
        .select({ id: profileRecordReviews.id })
        .from(profileRecordReviews)
        .where(
          and(
            eq(profileRecordReviews.recordId, record.id),
            gt(profileRecordReviews.step, review.step),
          ),
        )
        .orderBy(asc(profileRecordReviews.step))
        .limit(1)
      const transition = resolveProfileReviewTransition({
        result: parsed.data.result,
        hasNextReviewer: Boolean(nextReview),
      })
      if (transition.activateNextReview && nextReview) {
        await db
          .update(profileRecordReviews)
          .set({ result: "PENDING" })
          .where(eq(profileRecordReviews.id, nextReview.id))
      } else if (transition.recordStatus === "LOCKED") {
        const code = await generateProfileRecordCode()
        const officialSealData = await getOfficialSealData("PROFILE")
        await db
          .update(profileRecords)
          .set({
            status: "LOCKED",
            code,
            officialSealData,
            lockedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(profileRecords.id, record.id))
      }
    }
    await writeAuditLog({
      actor,
      action: "REVIEW",
      actionLabel:
        parsed.data.result === "APPROVED" ? "通过档案会签" : "退回档案修改",
      entityType: "profile_record",
      entityId: record.id,
      detail: { reviewId: review.id, grade: parsed.data.grade ?? null },
    })
    return success(updatedReview)
  } catch (error) {
    console.error("[API profile-reviews PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
