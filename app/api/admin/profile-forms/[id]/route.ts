import { eq, inArray } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { getAdminUser } from "@/lib/admin-api"
import { ProfileFormSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  numberingRules,
  profileFields,
  profileForms,
  profileRecordReviews,
  profileRecords,
} from "@/lib/db/schema"
import { getHighestSequentialCodeNumber } from "@/lib/numbering"

const PROFILE_RECORD_DOC_TYPE = "PROFILE_RECORD"

const ParamsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理档案表单", 403)
  const [params, parsed] = await Promise.all([
    context.params.then((value) => ParamsSchema.safeParse(value)),
    request.json().then((value: unknown) => ProfileFormSchema.safeParse(value)),
  ])
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "档案表单参数不合法", 400)
  try {
    const result = await db.transaction(async (tx) => {
      const [form] = await tx
        .update(profileForms)
        .set({
          name: parsed.data.name,
          targetType: parsed.data.targetType,
          content: parsed.data.content ?? null,
          active: parsed.data.active,
          updatedAt: new Date(),
        })
        .where(eq(profileForms.id, params.data.id))
        .returning()
      if (!form) return null
      await tx.delete(profileFields).where(eq(profileFields.formId, form.id))
      const fields = await tx
        .insert(profileFields)
        .values(
          parsed.data.fields.map((field, sort) => ({
            ...field,
            formId: form.id,
            sort,
          })),
        )
        .returning()
      return { ...form, fields }
    })
    if (!result) return failure("NOT_FOUND", "档案表单不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "更新档案表单",
      entityType: "profile_form",
      entityId: result.id,
      detail: { name: result.name },
    })
    return success(result)
  } catch (error) {
    console.error("[API profile-forms PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理档案表单", 403)
  const params = ParamsSchema.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const records = await db
      .select({ id: profileRecords.id, status: profileRecords.status })
      .from(profileRecords)
      .where(eq(profileRecords.formId, params.data.id))
    if (records.some((record) => record.status !== "LOCKED"))
      return failure("CONFLICT", "该表单仍有未归档档案，归档完成后才能删除", 409)
    const deleted = await db.transaction(async (tx) => {
      if (records.length) {
        await tx
          .delete(profileRecordReviews)
          .where(
            inArray(
              profileRecordReviews.recordId,
              records.map((record) => record.id),
            ),
          )
        await tx
          .delete(profileRecords)
          .where(eq(profileRecords.formId, params.data.id))
        const [rule] = await tx
          .select()
          .from(numberingRules)
          .where(eq(numberingRules.docType, PROFILE_RECORD_DOC_TYPE))
          .limit(1)
        if (rule?.generationMode === "SEQUENTIAL") {
          const remainingRecords = await tx
            .select({ code: profileRecords.code })
            .from(profileRecords)
          const currentSeq = getHighestSequentialCodeNumber({
            codes: remainingRecords.flatMap((record) =>
              record.code ? [record.code] : [],
            ),
            prefix: rule.prefix,
            dateFormat: rule.dateFormat,
            minLength: rule.minLength,
          })
          await tx
            .update(numberingRules)
            .set({ currentSeq, updatedAt: new Date() })
            .where(eq(numberingRules.id, rule.id))
        }
      }
      const [form] = await tx
        .delete(profileForms)
        .where(eq(profileForms.id, params.data.id))
        .returning({ id: profileForms.id, name: profileForms.name })
      return form
    })
    if (!deleted) return failure("NOT_FOUND", "档案表单不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除档案表单",
      entityType: "profile_form",
      entityId: deleted.id,
      detail: { name: deleted.name, archivedRecordCount: records.length },
    })
    return success(deleted)
  } catch (error) {
    console.error("[API profile-forms DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
