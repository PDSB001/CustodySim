import { and, eq, inArray } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { profileRecordReviews, profileRecords } from "@/lib/db/schema"
import { validateFieldPayload } from "@/lib/fields"
import { getSessionUser } from "@/lib/session"
import {
  getAdminUserId,
  getSupervisorIdsForSupervised,
} from "@/lib/supervision-scope"
import {
  buildProfileReviewerIds,
  isEditableProfileRecord,
} from "@/lib/profile-record"
import { applyComputedProfileAge } from "@/lib/profile-age"

const SubmissionSchema = z.object({ recordId: z.string().uuid() })
const SnapshotSchema = z.object({
  fields: z.array(
    z.object({
      name: z.string(),
      type: z.enum([
        "TEXT",
        "TEXTAREA",
        "NUMBER",
        "SELECT",
        "DATE",
        "COPYWRITE",
        "IMAGE",
      ]),
      required: z.boolean(),
      options: z.array(z.string()),
    }),
  ),
})

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可提交档案", 403)
  const parsed = SubmissionSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "提交参数不合法", 400)
  try {
    const [record] = await db
      .select()
      .from(profileRecords)
      .where(
        and(
          eq(profileRecords.id, parsed.data.recordId),
          eq(profileRecords.userId, actor.id),
        ),
      )
      .limit(1)
    if (!record) return failure("NOT_FOUND", "档案记录不存在", 404)
    if (!isEditableProfileRecord(record.status))
      return failure("CONFLICT", "当前档案不可重复提交", 409)
    const snapshot = SnapshotSchema.safeParse(record.formSnapshot)
    if (!snapshot.success)
      return failure(
        "VALIDATION_ERROR",
        "档案表单快照无效，请重新保存草稿",
        400,
      )
    const data = z.record(z.string(), z.unknown()).safeParse(record.data)
    if (!data.success)
      return failure("VALIDATION_ERROR", "档案数据无效，请重新填写", 400)
    const normalizedData = applyComputedProfileAge(
      data.data,
      snapshot.data.fields,
    )
    const validation = validateFieldPayload(
      snapshot.data.fields,
      normalizedData,
    )
    if (!validation.valid)
      return failure("VALIDATION_ERROR", JSON.stringify(validation.errors), 400)
    const [supervisorIds, adminId] = await Promise.all([
      getSupervisorIdsForSupervised(actor.id),
      getAdminUserId(),
    ])
    if (!adminId)
      return failure(
        "VALIDATION_ERROR",
        "尚未配置管理处审核账号，无法提交",
        400,
      )
    const reviewerIds = buildProfileReviewerIds({
      supervisorIds: [...supervisorIds],
      adminId,
    })
    const submitted = await db.transaction(async (tx) => {
      const [lockedRecord] = await tx
        .select()
        .from(profileRecords)
        .where(
          and(
            eq(profileRecords.id, record.id),
            eq(profileRecords.userId, actor.id),
          ),
        )
        .limit(1)
        .for("update")
      if (!lockedRecord || !isEditableProfileRecord(lockedRecord.status))
        return { status: "CONFLICT" as const }
      const lockedSnapshot = SnapshotSchema.safeParse(lockedRecord.formSnapshot)
      const lockedData = z
        .record(z.string(), z.unknown())
        .safeParse(lockedRecord.data)
      if (!lockedSnapshot.success || !lockedData.success)
        return { status: "INVALID" as const }
      const lockedNormalizedData = applyComputedProfileAge(
        lockedData.data,
        lockedSnapshot.data.fields,
      )
      if (
        !validateFieldPayload(lockedSnapshot.data.fields, lockedNormalizedData)
          .valid
      )
        return { status: "INVALID" as const }
      await tx
        .delete(profileRecordReviews)
        .where(eq(profileRecordReviews.recordId, record.id))
      await tx.insert(profileRecordReviews).values(
        reviewerIds.map((reviewerId, step) => ({
          recordId: record.id,
          reviewerId,
          step,
          result: step === 0 ? "PENDING" : "WAITING",
        })),
      )
      await tx
        .update(profileRecords)
        .set({
          data: lockedNormalizedData,
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(profileRecords.id, record.id),
            inArray(profileRecords.status, ["DRAFT", "RETURNED"]),
          ),
        )
      return { status: "SUBMITTED" as const }
    })
    if (submitted.status === "CONFLICT")
      return failure("CONFLICT", "档案状态已变化，请刷新后重试", 409)
    if (submitted.status === "INVALID")
      return failure("VALIDATION_ERROR", "档案数据已变化，请重新检查", 400)
    await writeAuditLog({
      actor,
      action: "SUBMIT",
      actionLabel: "提交档案会签",
      entityType: "profile_record",
      entityId: record.id,
      detail: { reviewerCount: reviewerIds.length },
    })
    return success({ id: record.id, status: "PENDING_REVIEW" })
  } catch (error) {
    console.error("[API profile-records/submit POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
