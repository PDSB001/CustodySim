import { and, asc, desc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { ApplicationDraftSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { APPLICATION_TYPE_LABELS, buildApplicationReviewerIds } from "@/lib/application"
import { db } from "@/lib/db"
import {
  applicationReviews,
  applications,
  profileForms,
  profileRecords,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { shanghaiLocalToIso } from "@/lib/shanghai-datetime"
import { getAdminUserId, getSupervisorIdsForSupervised } from "@/lib/supervision-scope"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看个人申请", 403)
  try {
    const [rows, reviews] = await Promise.all([
      db
        .select({
          id: applications.id,
          type: applications.type,
          title: applications.title,
          reason: applications.reason,
          payload: applications.payload,
          archiveRecordId: applications.archiveRecordId,
          archiveSnapshot: applications.archiveSnapshot,
          officialSealData: applications.officialSealData,
          status: applications.status,
          submittedAt: applications.submittedAt,
          decidedAt: applications.decidedAt,
          createdAt: applications.createdAt,
        })
        .from(applications)
        .where(eq(applications.userId, actor.id))
        .orderBy(desc(applications.createdAt)),
      db.select().from(applicationReviews).orderBy(asc(applicationReviews.step)),
    ])
    return success(
      rows.map((row) => ({
        ...row,
        reviews: reviews.filter((review) => review.applicationId === row.id),
      })),
    )
  } catch (error) {
    console.error("[API applications GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可发起申请", 403)
  const parsed = ApplicationDraftSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "申请数据不合法", 400)
  try {
    const [supervisorIds, adminId] = await Promise.all([
      getSupervisorIdsForSupervised(actor.id),
      getAdminUserId(),
    ])
    if (!adminId)
      return failure("VALIDATION_ERROR", "尚未配置管理处审核账号，无法提交", 400)

    let archiveSnapshot: Record<string, unknown> | null = null
    if (parsed.data.type === "SENTENCE_REDUCTION") {
      const [record] = await db
        .select({
          id: profileRecords.id,
          code: profileRecords.code,
          data: profileRecords.data,
          formName: profileForms.name,
          lockedAt: profileRecords.lockedAt,
        })
        .from(profileRecords)
        .innerJoin(profileForms, eq(profileForms.id, profileRecords.formId))
        .where(
          and(
            eq(profileRecords.id, parsed.data.archiveRecordId!),
            eq(profileRecords.userId, actor.id),
            eq(profileRecords.status, "LOCKED"),
          ),
        )
        .limit(1)
      if (!record)
        return failure("VALIDATION_ERROR", "请选择本人已归档的档案", 400)
      archiveSnapshot = {
        code: record.code,
        formName: record.formName,
        data: record.data,
        lockedAt: record.lockedAt?.toISOString() ?? null,
      }
    }
    const reviewerIds = buildApplicationReviewerIds({
      supervisorIds: [...supervisorIds],
      adminId,
    })
    const result = await db.transaction(async (tx) => {
      const [application] = await tx
        .insert(applications)
        .values({
          userId: actor.id,
          type: parsed.data.type,
          title: APPLICATION_TYPE_LABELS[parsed.data.type],
          reason: parsed.data.reason,
          payload:
                      parsed.data.type === "LEAVE"
                        ? {
                            leaveStartAt: shanghaiLocalToIso(parsed.data.leaveStartAt),
                            leaveEndAt: shanghaiLocalToIso(parsed.data.leaveEndAt),
                          }
                        : parsed.data.type === "TEMPORARY_OUT_OF_CUSTODY"
                          ? {
                              temporaryReleaseStartAt: shanghaiLocalToIso(
                                parsed.data.temporaryReleaseStartAt,
                              ),
                              temporaryReleaseEndAt: shanghaiLocalToIso(
                                parsed.data.temporaryReleaseEndAt,
                              ),
                            }
                          : {},
          archiveRecordId: parsed.data.archiveRecordId ?? null,
          archiveSnapshot,
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
        })
        .returning()
      if (!application) throw new Error("创建申请失败")
      await tx.insert(applicationReviews).values(
        reviewerIds.map((reviewerId, step) => ({
          applicationId: application.id,
          reviewerId,
          step,
          result: step === 0 ? "PENDING" : "WAITING",
        })),
      )
      return application
    })
    await writeAuditLog({
      actor,
      action: "SUBMIT",
      actionLabel: `提交${result.title}`,
      entityType: "application",
      entityId: result.id,
      detail: { type: result.type, reviewerCount: reviewerIds.length },
    })
    return success(result, { status: 201 })
  } catch (error) {
    console.error("[API applications POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
