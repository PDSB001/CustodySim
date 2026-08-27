import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { getAdminUser } from "@/lib/admin-api"
import { RuleSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { rules, ruleScopes } from "@/lib/db/schema"

const Params = z.object({ id: z.string().uuid() })

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理规则", 403)
  const params = Params.safeParse(await context.params)
  const parsed = RuleSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const { scopes, startDate, endDate, ...ruleData } = parsed.data
    const [updated] = await db
      .update(rules)
      .set({
        ...ruleData,
        ruleGroupId: ruleData.ruleGroupId ?? null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        updatedAt: new Date(),
      })
      .where(eq(rules.id, params.data.id))
      .returning()
    if (!updated) return failure("NOT_FOUND", "规则不存在", 404)
    await db.transaction(async (tx) => {
      await tx.delete(ruleScopes).where(eq(ruleScopes.ruleId, updated.id))
      if (scopes.length)
        await tx
          .insert(ruleScopes)
          .values(scopes.map((scope) => ({ ...scope, ruleId: updated.id })))
    })
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑任务规则",
      entityType: "rule",
      entityId: updated.id,
      detail: { name: ruleData.name },
    })
    return success(updated)
  } catch (error) {
    console.error("[API rules PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理规则", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [deleted] = await db
      .delete(rules)
      .where(eq(rules.id, params.data.id))
      .returning({ id: rules.id, name: rules.name })
    if (!deleted) return failure("NOT_FOUND", "规则不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除任务规则",
      entityType: "rule",
      entityId: deleted.id,
      detail: { name: deleted.name },
    })
    return success({ id: deleted.id })
  } catch (error) {
    console.error("[API rules DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}