import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { NumberingRuleSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { numberingRules } from "@/lib/db/schema"

const DOC_TYPE = "PRISONER"
const defaultRule = {
  docType: DOC_TYPE,
  prefix: "CS",
  dateFormat: "NONE",
  generationMode: "RANDOM",
  minLength: 4,
  randomLength: 6,
  currentSeq: 0,
}

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看编号规则", 403)
  const [rule] = await db
    .select()
    .from(numberingRules)
    .where(eq(numberingRules.docType, DOC_TYPE))
    .limit(1)
  return success(rule ?? defaultRule)
}

export async function PUT(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理编号规则", 403)
  const parsed = NumberingRuleSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const [existing] = await db
      .select()
      .from(numberingRules)
      .where(eq(numberingRules.docType, DOC_TYPE))
      .limit(1)
    const [saved] = existing
      ? await db
          .update(numberingRules)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(eq(numberingRules.id, existing.id))
          .returning()
      : await db
          .insert(numberingRules)
          .values({ docType: DOC_TYPE, ...parsed.data })
          .returning()
    if (!saved) return failure("INTERNAL_ERROR", "保存编号规则失败", 500)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "更新编号规则",
      entityType: "numbering_rule",
      entityId: saved.id,
      detail: parsed.data,
    })
    return success(saved)
  } catch (error) {
    console.error("[API admin/numbering PUT]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
