import { and, asc, eq, gt } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { ApplicationReviewSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { applicationReviews, applications, persons } from "@/lib/db/schema"
import {
  isLeaveActive,
  isTemporaryReleaseActive,
  resolveApplicationReviewTransition,
  type ApplicationType,
} from "@/lib/application"
import { getOfficialSealData } from "@/lib/seal-server"
import { getSessionUser } from "@/lib/session"

const ParamsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN")
    return failure("FORBIDDEN", "仅监管人或管理处可审核申请", 403)
  const [params, parsed] = await Promise.all([
    context.params.then((value) => ParamsSchema.safeParse(value)),
    request.json().then((value: unknown) => ApplicationReviewSchema.safeParse(value)),
  ])
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "审核参数不合法", 400)
  try {
    const [review] = await db
      .select()
      .from(applicationReviews)
      .where(
        and(
          eq(applicationReviews.id, params.data.id),
          eq(applicationReviews.reviewerId, actor.id),
        ),
      )
      .limit(1)
    if (!review || review.result !== "PENDING")
      return failure("CONFLICT", "该申请尚未轮到你审核或已处理", 409)
    const [application] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, review.applicationId))
      .limit(1)
    if (!application || application.status !== "PENDING_REVIEW")
      return failure("CONFLICT", "申请当前不在审核流程中", 409)

    await db.transaction(async (tx) => {
      await tx
        .update(applicationReviews)
        .set({
          result: parsed.data.result,
          comment: parsed.data.comment ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(applicationReviews.id, review.id))
      const [nextReview] =
        parsed.data.result === "APPROVED"
          ? await tx
              .select({ id: applicationReviews.id })
              .from(applicationReviews)
              .where(
                and(
                  eq(applicationReviews.applicationId, application.id),
                  gt(applicationReviews.step, review.step),
                ),
              )
              .orderBy(asc(applicationReviews.step))
              .limit(1)
          : []
      const transition = resolveApplicationReviewTransition({
        result: parsed.data.result,
        hasNextReviewer: Boolean(nextReview),
        applicationType: application.type as ApplicationType,
      })
      if (!transition.activateNextReview) {
        const officialSealData =
          transition.applicationStatus === "APPROVED"
            ? await getOfficialSealData("APPLICATION")
            : null
        await tx
          .update(applications)
          .set({
            status: transition.applicationStatus,
            officialSealData,
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(applications.id, application.id))
        const scheduledAbsenceStatus =
          transition.applicationStatus === "APPROVED" &&
          application.type === "LEAVE" &&
          isLeaveActive(application.payload)
            ? "ON_LEAVE"
            : transition.applicationStatus === "APPROVED" &&
                application.type === "TEMPORARY_OUT_OF_CUSTODY" &&
                isTemporaryReleaseActive(application.payload)
              ? "TEMPORARY_OUT_OF_CUSTODY"
              : null
        const custodyStatus =
          application.type === "LEAVE" ||
          application.type === "TEMPORARY_OUT_OF_CUSTODY"
            ? scheduledAbsenceStatus
            : transition.custodyStatus
        if (custodyStatus)
          await tx
            .update(persons)
            .set({ custodyStatus, updatedAt: new Date() })
            .where(eq(persons.userId, application.userId))
        return
      }
      await tx
        .update(applicationReviews)
        .set({ result: "PENDING" })
        .where(eq(applicationReviews.id, nextReview!.id))
    })
    await writeAuditLog({
      actor,
      action: "REVIEW",
      actionLabel:
        parsed.data.result === "APPROVED" ? "通过申请审核" : "处理申请审核",
      entityType: "application",
      entityId: application.id,
      detail: { reviewId: review.id, result: parsed.data.result, type: application.type },
    })
    return success({ id: review.id, result: parsed.data.result })
  } catch (error) {
    console.error("[API application-reviews PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
