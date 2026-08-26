import { asc, eq } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  profileForms,
  profileRecordReviews,
  profileRecords,
  users,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { decryptHandwrittenSignature } from "@/lib/signature-server"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN")
    return failure("FORBIDDEN", "仅监管人或管理处可处理档案审核", 403)
  try {
    const rows = await db
      .select({
        id: profileRecordReviews.id,
        recordId: profileRecordReviews.recordId,
        step: profileRecordReviews.step,
        result: profileRecordReviews.result,
        recordStatus: profileRecords.status,
        userId: profileRecords.userId,
        userName: users.name,
        formName: profileForms.name,
        formSnapshot: profileRecords.formSnapshot,
        data: profileRecords.data,
        photoData: profileRecords.photoData,
        signatureMode: profileRecords.signatureMode,
        generatedSignatureData: profileRecords.generatedSignatureData,
        handwrittenSignatureEncrypted:
          profileRecords.handwrittenSignatureEncrypted,
        officialSealData: profileRecords.officialSealData,
        submittedAt: profileRecords.submittedAt,
      })
      .from(profileRecordReviews)
      .innerJoin(
        profileRecords,
        eq(profileRecords.id, profileRecordReviews.recordId),
      )
      .innerJoin(users, eq(users.id, profileRecords.userId))
      .innerJoin(profileForms, eq(profileForms.id, profileRecords.formId))
      .where(eq(profileRecordReviews.reviewerId, actor.id))
      .orderBy(
        asc(profileRecordReviews.result),
        asc(profileRecords.submittedAt),
      )
    return success(
      rows.map(
        ({
          generatedSignatureData,
          handwrittenSignatureEncrypted,
          ...row
        }) => ({
          ...row,
          signatureData:
            row.signatureMode === "HANDWRITTEN" && handwrittenSignatureEncrypted
              ? decryptHandwrittenSignature(handwrittenSignatureEncrypted)
              : generatedSignatureData,
        }),
      ),
    )
  } catch (error) {
    console.error("[API profile-reviews GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
