import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { getAdminUser } from "@/lib/admin-api"
import { RuleGroupSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { ruleGroups, ruleGroupScopes } from "@/lib/db/schema"

const Params = z.object({ id: z.string().uuid() })

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理规则组", 403)
  const params = Params.safeParse(await context.params)
  const parsed = RuleGroupSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [updated] = await db
      .update(ruleGroups)
      .set({
        name: parsed.data.name,
        remark: parsed.data.remark ?? null,
        updatedAt: new Date(),
      })
      .where(eq(ruleGroups.id, params.data.id))
      .returning()
    if (!updated) return failure("NOT_FOUND", "规则组不存在", 404)
    await db.transaction(async (tx) => {
      await tx
        .delete(ruleGroupScopes)
        .where(eq(ruleGroupScopes.groupId, updated.id))
      if (parsed.data.scopes.length)
        await tx
          .insert(ruleGroupScopes)
          .values(
            parsed.data.scopes.map((scope) => ({
              ...scope,
              groupId: updated.id,
            })),
          )
    })
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑规则组",
      entityType: "rule_group",
      entityId: updated.id,
      detail: { name: updated.name },
    })
    return success(updated)
  } catch (error) {
    console.error("[API rule-groups PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理规则组", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [deleted] = await db
      .delete(ruleGroups)
      .where(eq(ruleGroups.id, params.data.id))
      .returning({ id: ruleGroups.id, name: ruleGroups.name })
    if (!deleted) return failure("NOT_FOUND", "规则组不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除规则组",
      entityType: "rule_group",
      entityId: deleted.id,
      detail: { name: deleted.name },
    })
    return success({ id: deleted.id })
  } catch (error) {
    console.error("[API rule-groups DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}