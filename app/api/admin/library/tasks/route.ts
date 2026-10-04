import { and, asc, desc, eq, gt } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  rules,
  ruleScopes,
  users,
  ruleGroups,
  ruleGroupScopes,
} from "@/lib/db/schema"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import {
  ReadingRuleCreate,
  nextReadingRuleStart,
} from "@/lib/library-task-config"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理阅读任务", 403)
  const [readingRules, scopes, supervised, groups] = await Promise.all([
    db
      .select()
      .from(rules)
      .where(and(eq(rules.taskType, "STUDY"), gt(rules.readingMinutes, 0)))
      .orderBy(desc(rules.createdAt)),
    db.select().from(ruleScopes),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.role, "SUPERVISED"))
      .orderBy(asc(users.name)),
    db
      .select({ id: ruleGroups.id, name: ruleGroups.name })
      .from(ruleGroups)
      .orderBy(asc(ruleGroups.name)),
  ])
  return success({
    rules: readingRules.map((rule) => ({
      ...rule,
      scopes: scopes.filter((scope) => scope.ruleId === rule.id),
    })),
    users: supervised,
    groups,
  })
}

export async function POST(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理阅读任务", 403)
  const parsed = ReadingRuleCreate.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "任务配置无效",
      400,
    )
  const input = parsed.data
  const targets = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPERVISED"),
        input.userId ? eq(users.id, input.userId) : undefined,
      ),
    )
  if (input.userId && !targets.length)
    return failure("VALIDATION_ERROR", "被监管人不存在", 400)
  if (input.groupId) {
    const [group] = await db
      .select({ id: ruleGroups.id })
      .from(ruleGroups)
      .where(eq(ruleGroups.id, input.groupId))
    const [scope] = await db
      .select({ id: ruleGroupScopes.id })
      .from(ruleGroupScopes)
      .where(eq(ruleGroupScopes.groupId, input.groupId))
      .limit(1)
    if (!group || !scope)
      return failure("VALIDATION_ERROR", "任务组不存在或尚未设置成员范围", 400)
  } else if (!targets.length)
    return failure("VALIDATION_ERROR", "请先创建被监管人后再设置阅读任务", 400)
  const rule = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rules)
      .values({
        name: input.name,
        type: "STUDY",
        taskType: "STUDY",
        readingMinutes: input.readingMinutes,
        freq: "DAILY",
        scheduleDays: [],
        timeSlots: [input.timeSlot],
        timeoutMinutes: input.timeoutMinutes,
        enabled: true,
        startDate: nextReadingRuleStart(input.timeSlot),
        ruleGroupId: input.groupId ?? null,
        templateId: null,
        taskPoolId: null,
      })
      .returning()
    // Empty existing rule scopes target nobody. Explicit USER scopes make the all-current-users option effective.
    const scopes = input.groupId
      ? []
      : await tx
          .insert(ruleScopes)
          .values(
            targets.map(({ id }) => ({
              ruleId: created.id,
              targetType: "USER",
              targetId: id,
            })),
          )
          .returning()
    await writeAuditLog(
      {
        actor,
        action: "CREATE",
        actionLabel: "创建阅读任务",
        entityType: "rule",
        entityId: created.id,
        detail: {
          name: input.name,
          readingMinutes: input.readingMinutes,
          targetCount: input.groupId ? null : targets.length,
          groupId: input.groupId ?? null,
        },
      },
      tx,
    )
    return { ...created, scopes }
  })
  return success(rule, { status: 201 })
}
