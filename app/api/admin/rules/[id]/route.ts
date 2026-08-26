import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { RuleSchema } from "@/lib/admin-schemas"
import { db } from "@/lib/db"
import { rules, ruleScopes } from "@/lib/db/schema"
const Params = z.object({ id: z.string().uuid() })
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理规则", 403)
  const params = Params.safeParse(await context.params)
  const parsed = RuleSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "参数不合法", 400)
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
  await db.delete(ruleScopes).where(eq(ruleScopes.ruleId, updated.id))
  if (scopes.length)
    await db
      .insert(ruleScopes)
      .values(scopes.map((scope) => ({ ...scope, ruleId: updated.id })))
  return success(updated)
}
export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理规则", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const [deleted] = await db
    .delete(rules)
    .where(eq(rules.id, params.data.id))
    .returning()
  return deleted
    ? success({ id: deleted.id })
    : failure("NOT_FOUND", "规则不存在", 404)
}
