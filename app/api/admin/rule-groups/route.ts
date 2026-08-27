import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { writeAuditLog } from "@/lib/audit"
import { getAdminUser } from "@/lib/admin-api"
import { RuleGroupSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { ruleGroups, ruleGroupScopes } from "@/lib/db/schema"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看规则组", 403)
  try {
    const groups = await db
      .select()
      .from(ruleGroups)
      .orderBy(asc(ruleGroups.createdAt))
    const scopes = await db.select().from(ruleGroupScopes)
    return success(
      groups.map((group) => ({
        ...group,
        scopes: scopes.filter((scope) => scope.groupId === group.id),
      })),
    )
  } catch (error) {
    console.error("[API rule-groups GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理规则组", 403)
  const parsed = RuleGroupSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const [group] = await db
      .insert(ruleGroups)
      .values({ name: parsed.data.name, remark: parsed.data.remark ?? null })
      .returning()
    if (!group) return failure("INTERNAL_ERROR", "创建规则组失败", 500)
    const insertedScopes = parsed.data.scopes.length
      ? await db
          .insert(ruleGroupScopes)
          .values(
            parsed.data.scopes.map((scope) => ({ ...scope, groupId: group.id })),
          )
          .returning()
      : []
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建规则组",
      entityType: "rule_group",
      entityId: group.id,
      detail: { name: group.name },
    })
    return success({ ...group, scopes: insertedScopes }, { status: 201 })
  } catch (error) {
    console.error("[API rule-groups POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}