import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { RuleGroupSchema } from "@/lib/admin-schemas"
import { db } from "@/lib/db"
import { ruleGroups, ruleGroupScopes } from "@/lib/db/schema"
const Params = z.object({ id: z.string().uuid() })
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理规则组", 403)
  const params = Params.safeParse(await context.params)
  const parsed = RuleGroupSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "参数不合法", 400)
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
  await db
    .delete(ruleGroupScopes)
    .where(eq(ruleGroupScopes.groupId, updated.id))
  if (parsed.data.scopes.length)
    await db
      .insert(ruleGroupScopes)
      .values(
        parsed.data.scopes.map((scope) => ({ ...scope, groupId: updated.id })),
      )
  return success(updated)
}
export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理规则组", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const [deleted] = await db
    .delete(ruleGroups)
    .where(eq(ruleGroups.id, params.data.id))
    .returning()
  return deleted
    ? success({ id: deleted.id })
    : failure("NOT_FOUND", "规则组不存在", 404)
}
