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
    const updatedReview = await db.transaction(async (tx) => {
      const [review] = await tx
        .select()
        .from(profileRecordReviews)
        .where(
          and(
            eq(profileRecordReviews.id, params.data.id),
            eq(profileRecordReviews.reviewerId, actor.id),
          ),
        )
        .limit(1)
        .for("update")
      if (!review)
        return { error: failure("NOT_FOUND", "待处理会签不存在", 404) }
      if (review.result !== "PENDING")
        return {
          error: failure("CONFLICT", "该会签尚未轮到你处理或已完成", 409),
        }

      const [record] = await tx
        .select()
        .from(profileRecords)
        .where(eq(profileRecords.id, review.recordId))
        .limit(1)
        .for("update")
      if (!record || record.status !== "PENDING_REVIEW")
        return { error: failure("CONFLICT", "档案当前不在会签流程中", 409) }

      const [updated] = await tx
        .update(profileRecordReviews)
        .set({
          result: parsed.data.result,
          grade: parsed.data.grade ?? null,
          comment: parsed.data.comment ?? null,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(profileRecordReviews.id, review.id),
            eq(profileRecordReviews.reviewerId, actor.id),
            eq(profileRecordReviews.result, "PENDING"),
          ),
        )
        .returning()
      if (!updated)
        return { error: failure("CONFLICT", "该会签已由其他请求处理", 409) }

      if (parsed.data.result === "RETURNED") {
        await tx
          .update(profileRecords)
          .set({ status: "RETURNED", updatedAt: new Date() })
          .where(eq(profileRecords.id, record.id))
      } else {
        const [nextReview] = await tx
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
          await tx
            .update(profileRecordReviews)
            .set({ result: "PENDING" })
            .where(eq(profileRecordReviews.id, nextReview.id))
        } else if (transition.recordStatus === "LOCKED") {
          const code = await generateProfileRecordCode(tx)
          const officialSealData = await getOfficialSealData("PROFILE")
          await tx
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
      await writeAuditLog(
        {
          actor,
          action: "REVIEW",
          actionLabel:
            parsed.data.result === "APPROVED" ? "通过档案会签" : "退回档案修改",
          entityType: "profile_record",
          entityId: record.id,
          detail: { reviewId: review.id, grade: parsed.data.grade ?? null },
        },
        tx,
      )
      return { data: updated }
    })
    if ("error" in updatedReview) return updatedReview.error
    return success(updatedReview.data)
  } catch (error) {
    console.error("[API profile-reviews PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
