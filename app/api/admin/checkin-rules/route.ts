import { asc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { CheckinRuleSchema } from "@/lib/admin-schemas"
import { ensureCustodyCheckinPresets } from "@/lib/custody-checkin"
import { db } from "@/lib/db"
import { rules, ruleScopes } from "@/lib/db/schema"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看打卡规则", 403)
  try {
    await ensureCustodyCheckinPresets()
    const rows = await db
      .select()
      .from(rules)
      .where(eq(rules.type, "CHECKIN"))
      .orderBy(asc(rules.createdAt))
    const scopes = await db.select().from(ruleScopes)
    return success(
      rows.map((rule) => ({
        ...rule,
        scopes: scopes.filter((scope) => scope.ruleId === rule.id),
      })),
    )
  } catch (error) {
    console.error("[API checkin-rules GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理打卡规则", 403)
  const parsed = CheckinRuleSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const { scopes, startDate, endDate, slotSettings, ...ruleData } = parsed.data
    const [rule] = await db
      .insert(rules)
      .values({
        ...ruleData,
        type: "CHECKIN",
        taskType: "CHECKIN",
        timeSlots: slotSettings.length
          ? slotSettings.map((slot) => slot.time)
          : ruleData.timeSlots,
        slotSettings,
        custodyLevel: ruleData.custodyLevel ?? null,
        ruleGroupId: ruleData.ruleGroupId ?? null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      })
      .returning()
    if (!rule) return failure("INTERNAL_ERROR", "创建打卡规则失败", 500)
    const insertedScopes = scopes.length
      ? await db
          .insert(ruleScopes)
          .values(scopes.map((scope) => ({ ...scope, ruleId: rule.id })))
          .returning()
      : []
    return success({ ...rule, scopes: insertedScopes }, { status: 201 })
  } catch (error) {
    console.error("[API checkin-rules POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
