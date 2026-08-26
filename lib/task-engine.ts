import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  organizations,
  reportTemplateFields,
  reportTemplates,
  reportTasks,
  ruleGroupScopes,
  ruleScopes,
  rules,
  users,
} from "@/lib/db/schema"
import {
  expandRuleTargets,
  resolveScopes,
  type TargetScope,
} from "@/lib/rule-engine"
import {
  computeDeadline,
  isRuleScheduledForDate,
  parseSlots,
  type RuleFrequency,
} from "@/lib/rule-cycle"
import { getSupervisorIdsForSupervised } from "@/lib/supervision-scope"

function dateAtSlot(date: Date, slot: string) {
  const [hours, minutes] = slot.split(":").map(Number)
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result
}

export async function ensureUserTasks(userId: string, now = new Date()) {
  const [
    allRules,
    ownScopes,
    inheritedScopes,
    allOrganizations,
    supervisedUsers,
    templates,
    templateFields,
  ] = await Promise.all([
    db.select().from(rules).where(eq(rules.enabled, true)),
    db.select().from(ruleScopes),
    db.select().from(ruleGroupScopes),
    db
      .select({ id: organizations.id, parentId: organizations.parentId })
      .from(organizations),
    db
      .select({ id: users.id, organizationId: users.organizationId })
      .from(users)
      .where(eq(users.role, "SUPERVISED")),
    db.select().from(reportTemplates),
    db.select().from(reportTemplateFields),
  ])
  const { buildOrgDescendantsMap } = await import("@/lib/supervision-scope")
  const descendants = buildOrgDescendantsMap(allOrganizations)
  const supervisorIds = await getSupervisorIdsForSupervised(userId)
  for (const rule of allRules) {
    if (!["REPORT", "STUDY", "LABOR"].includes(rule.taskType)) continue
    const scopes = resolveScopes({
      ownScopes: ownScopes.filter(
        (scope) => scope.ruleId === rule.id,
      ) as TargetScope[],
      groupScopes: rule.ruleGroupId
        ? (inheritedScopes.filter(
            (scope) => scope.groupId === rule.ruleGroupId,
          ) as TargetScope[])
        : [],
    })
    if (!expandRuleTargets(scopes, descendants, supervisedUsers).has(userId))
      continue
    if (
      !isRuleScheduledForDate(
        {
          freq: rule.freq as RuleFrequency,
          scheduleDays: rule.scheduleDays,
          startDate: rule.startDate,
          endDate: rule.endDate,
        },
        now,
      )
    )
      continue
    for (const slot of parseSlots(rule.timeSlots)) {
      const scheduleAt = dateAtSlot(now, slot)
      if (scheduleAt > now) continue
      const template = rule.templateId
        ? templates.find((item) => item.id === rule.templateId)
        : null
      const templateSnapshot = template
        ? {
            name: template.name,
            kind: template.kind,
            content: template.content,
            fields: templateFields
              .filter((field) => field.templateId === template.id)
              .map((field) => ({
                name: field.name,
                type: field.type,
                required: field.required,
                options: field.options,
              })),
          }
        : {}
      await db
        .insert(reportTasks)
        .values({
          title: rule.name,
          ruleId: rule.id,
          templateId: template?.id ?? null,
          templateSnapshot,
          supervisedId: userId,
          supervisorId: [...supervisorIds][0] ?? null,
          scheduleAt,
          deadline: computeDeadline(scheduleAt, rule.timeoutMinutes),
          source: "RULE",
        })
        .onConflictDoNothing()
    }
  }
}
