import { asc, eq } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { applicationReviews, applications, users } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN")
    return failure("FORBIDDEN", "仅监管人或管理处可审核申请", 403)
  try {
    const rows = await db
      .select({
        id: applicationReviews.id,
        applicationId: applications.id,
        step: applicationReviews.step,
        result: applicationReviews.result,
        userName: users.name,
        type: applications.type,
        title: applications.title,
        reason: applications.reason,
        payload: applications.payload,
        archiveSnapshot: applications.archiveSnapshot,
        officialSealData: applications.officialSealData,
        status: applications.status,
        submittedAt: applications.submittedAt,
      })
      .from(applicationReviews)
      .innerJoin(applications, eq(applications.id, applicationReviews.applicationId))
      .innerJoin(users, eq(users.id, applications.userId))
      .where(eq(applicationReviews.reviewerId, actor.id))
      .orderBy(asc(applicationReviews.result), asc(applications.submittedAt))
    return success(rows)
  } catch (error) {
    console.error("[API application-reviews GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
