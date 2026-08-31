import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { NextRequest } from "next/server"

import { ProfileRecordDraftSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  archiveBoxes,
  profileFields,
  profileForms,
  profileRecordReviews,
  profileRecords,
  users,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"
import { isEditableProfileRecord } from "@/lib/profile-record"
import { applyComputedProfileAge } from "@/lib/profile-age"
import {
  decryptHandwrittenSignature,
  encryptHandwrittenSignature,
  generateFormattedSignatureData,
} from "@/lib/signature-server"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const userIds = [...(await getSupervisedUserIdsForActor(actor))]
    if (!userIds.length) return success([])
    const where =
      actor.role === "SUPERVISED"
        ? eq(profileRecords.userId, actor.id)
        : inArray(profileRecords.userId, userIds)
    const [rows, fields, reviews] = await Promise.all([
      db
        .select({
          id: profileRecords.id,
          userId: profileRecords.userId,
          userName: users.name,
          formId: profileRecords.formId,
          formName: profileForms.name,
          formContent: profileForms.content,
          formSnapshot: profileRecords.formSnapshot,
          data: profileRecords.data,
          photoData: profileRecords.photoData,
          signatureMode: profileRecords.signatureMode,
          generatedSignatureData: profileRecords.generatedSignatureData,
          handwrittenSignatureEncrypted:
            profileRecords.handwrittenSignatureEncrypted,
          officialSealData: profileRecords.officialSealData,
          status: profileRecords.status,
          code: profileRecords.code,
          boxId: profileRecords.boxId,
          boxName: archiveBoxes.name,
          submittedAt: profileRecords.submittedAt,
          lockedAt: profileRecords.lockedAt,
          createdAt: profileRecords.createdAt,
          updatedAt: profileRecords.updatedAt,
        })
        .from(profileRecords)
        .innerJoin(users, eq(users.id, profileRecords.userId))
        .innerJoin(profileForms, eq(profileForms.id, profileRecords.formId))
        .leftJoin(archiveBoxes, eq(archiveBoxes.id, profileRecords.boxId))
        .where(where)
        .orderBy(desc(profileRecords.updatedAt)),
      db.select().from(profileFields).orderBy(asc(profileFields.sort)),
      db
        .select()
        .from(profileRecordReviews)
        .orderBy(asc(profileRecordReviews.step)),
    ])
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
          fields: fields.filter((field) => field.formId === row.formId),
          reviews: reviews.filter((review) => review.recordId === row.id),
        }),
      ),
    )
  } catch (error) {
    console.error("[API profile-records GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可填写档案", 403)
  const parsed = ProfileRecordDraftSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "档案数据不合法", 400)
  try {
    const [form] = await db
      .select()
      .from(profileForms)
      .where(
        and(
          eq(profileForms.id, parsed.data.formId),
          eq(profileForms.active, true),
        ),
      )
      .limit(1)
    if (!form) return failure("NOT_FOUND", "档案表单不存在或已停用", 404)
    const fields = await db
      .select()
      .from(profileFields)
      .where(eq(profileFields.formId, form.id))
      .orderBy(asc(profileFields.sort))
    const snapshot = {
      name: form.name,
      content: form.content,
      fields: fields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        options: field.options,
      })),
    }
    const data = applyComputedProfileAge(parsed.data.data, fields)
    const [existing] = await db
      .select({ id: profileRecords.id, status: profileRecords.status })
      .from(profileRecords)
      .where(
        and(
          eq(profileRecords.userId, actor.id),
          eq(profileRecords.formId, form.id),
        ),
      )
      .limit(1)
    if (existing && !isEditableProfileRecord(existing.status))
      return failure("CONFLICT", "该档案已提交审核，暂不能修改", 409)
    if (
      parsed.data.signatureMode === "HANDWRITTEN" &&
      !parsed.data.handwrittenSignatureData
    )
      return failure("VALIDATION_ERROR", "请完成手写签名后再保存", 400)
    const signature =
      parsed.data.signatureMode === "HANDWRITTEN"
        ? {
            signatureMode: "HANDWRITTEN" as const,
            generatedSignatureData: null,
            handwrittenSignatureEncrypted: encryptHandwrittenSignature(
              parsed.data.handwrittenSignatureData!,
            ),
          }
        : {
            signatureMode: "GENERATED" as const,
            generatedSignatureData: generateFormattedSignatureData(actor.name),
            handwrittenSignatureEncrypted: null,
          }
    const [saved] = existing
      ? await db
          .update(profileRecords)
          .set({
            data,
            photoData: parsed.data.photoData ?? null,
            ...signature,
            officialSealData: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(profileRecords.id, existing.id),
              inArray(profileRecords.status, ["DRAFT", "RETURNED"]),
            ),
          )
          .returning()
      : await db
          .insert(profileRecords)
          .values({
            userId: actor.id,
            formId: form.id,
            data,
            formSnapshot: snapshot,
            photoData: parsed.data.photoData ?? null,
            ...signature,
          })
          .returning()
    if (!saved) return failure("CONFLICT", "档案状态已变化，请刷新后重试", 409)
    return success(saved, { status: existing ? 200 : 201 })
  } catch (error) {
    console.error("[API profile-records POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
