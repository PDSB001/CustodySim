import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"
import { writeAuditLog } from "@/lib/audit"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { RuleSchema } from "@/lib/admin-schemas"
import { db } from "@/lib/db"
import { rules, ruleScopes } from "@/lib/db/schema"
export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看规则", 403)
  try {
    const rows = await db.select().from(rules).orderBy(asc(rules.createdAt))
    const scopes = await db.select().from(ruleScopes)
    return success(
      rows.map((rule) => ({
        ...rule,
        scopes: scopes.filter((scope) => scope.ruleId === rule.id),
      })),
    )
  } catch (error) {
    console.error("[API rules GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理规则", 403)
  const parsed = RuleSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const { scopes, startDate, endDate, ...ruleData } = parsed.data
    const [rule] = await db
      .insert(rules)
      .values({
        ...ruleData,
        ruleGroupId: ruleData.ruleGroupId ?? null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      })
      .returning()
    if (!rule) return failure("INTERNAL_ERROR", "创建规则失败", 500)
    const insertedScopes = scopes.length
      ? await db
          .insert(ruleScopes)
          .values(scopes.map((scope) => ({ ...scope, ruleId: rule.id })))
          .returning()
      : []
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建任务规则",
      entityType: "rule",
      entityId: rule.id,
      detail: { name: ruleData.name, type: ruleData.type },
    })
    return success({ ...rule, scopes: insertedScopes }, { status: 201 })
  } catch (error) {
    console.error("[API rules POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
