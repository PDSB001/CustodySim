import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  numberingRules,
  profileRecordReviews,
  profileRecords,
} from "@/lib/db/schema"
import { getHighestSequentialCodeNumber } from "@/lib/numbering"

const ParamsSchema = z.object({ id: z.string().uuid() })
const PROFILE_RECORD_DOC_TYPE = "PROFILE_RECORD"
type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可删除归档档案", 403)
  const params = ParamsSchema.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "档案编号不合法", 400)
  try {
    const [record] = await db
      .select({ id: profileRecords.id, status: profileRecords.status })
      .from(profileRecords)
      .where(eq(profileRecords.id, params.data.id))
      .limit(1)
    if (!record) return failure("NOT_FOUND", "档案记录不存在", 404)
    if (record.status !== "LOCKED")
      return failure("CONFLICT", "只有已归档档案可以删除", 409)
    const deleted = await db.transaction(async (tx) => {
      await tx
        .delete(profileRecordReviews)
        .where(eq(profileRecordReviews.recordId, record.id))
      const [result] = await tx
        .delete(profileRecords)
        .where(
          and(
            eq(profileRecords.id, record.id),
            eq(profileRecords.status, "LOCKED"),
          ),
        )
        .returning({
          id: profileRecords.id,
          userId: profileRecords.userId,
        })
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
          codes: remainingRecords.flatMap((item) =>
            item.code ? [item.code] : [],
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
      return result
    })
    if (!deleted) return failure("NOT_FOUND", "档案记录不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除归档档案",
      entityType: "profile_record",
      entityId: deleted.id,
      detail: { userId: deleted.userId, status: "LOCKED" },
    })
    return success({ id: deleted.id })
  } catch (error) {
    console.error("[API admin/profile-records DELETE]", error)
    return failure("INTERNAL_ERROR", "删除归档档案失败", 500)
  }
}
