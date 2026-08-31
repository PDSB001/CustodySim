import { and, eq, inArray, isNull, lt, lte } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  organizations,
  persons,
  reportTemplateFields,
  reportTemplates,
  reportTasks,
  ruleGroupScopes,
  ruleScopes,
  rules,
  scoreEvents,
  taskPools,
  taskPoolTemplates,
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
import {
  getTaskOutcomeWeekKey,
  recordScoreEvent,
  SCORE_POLICY,
} from "@/lib/scoring"
import { getShanghaiDateAtTime } from "@/lib/shanghai-datetime"

function dateAtSlot(date: Date, slot: string) {
  return getShanghaiDateAtTime(date, slot)
}

function stableIndex(seed: string, length: number) {
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % length
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
    pools,
    poolLinks,
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
    db.select().from(taskPools).where(eq(taskPools.enabled, true)),
    db.select().from(taskPoolTemplates),
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
      const pool = rule.taskPoolId
        ? pools.find((item) => item.id === rule.taskPoolId)
        : null
      const poolTemplates = pool
        ? poolLinks
            .filter((link) => link.poolId === pool.id)
            .map((link) =>
              templates.find((item) => item.id === link.templateId),
            )
            .filter((item): item is (typeof templates)[number] => Boolean(item))
            .filter((item) => item.kind === rule.taskType)
        : []
      const template = pool
        ? poolTemplates[
            stableIndex(
              `${rule.id}:${userId}:${scheduleAt.toISOString()}`,
              poolTemplates.length,
            )
          ]
        : rule.templateId
          ? templates.find((item) => item.id === rule.templateId)
          : null
      if (pool && !template) continue
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
          source: pool ? "RANDOM_POOL" : "RULE",
        })
        .onConflictDoNothing()
    }
  }
}

export async function ensureScheduledTasks(now = new Date()) {
  const supervisedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "SUPERVISED"))
  for (const user of supervisedUsers) await ensureUserTasks(user.id, now)
}

export async function runLeaveTaskAutoApprovalSweep(now = new Date()) {
  const leaveProfiles = await db
    .select({ userId: persons.userId })
    .from(persons)
    .where(
      and(
        eq(persons.personType, "SUPERVISED"),
        eq(persons.custodyStatus, "ON_LEAVE"),
      ),
    )
  const leaveUserIds = leaveProfiles.flatMap((profile) =>
    profile.userId ? [profile.userId] : [],
  )
  if (!leaveUserIds.length) return 0
  const approvedTasks = await db
    .update(reportTasks)
    .set({ status: "APPROVED", updatedAt: now })
    .where(
      and(
        inArray(reportTasks.supervisedId, leaveUserIds),
        inArray(reportTasks.status, ["PENDING", "SUBMITTED", "RETURNED"]),
        lte(reportTasks.scheduleAt, now),
      ),
    )
    .returning({ id: reportTasks.id })
  return approvedTasks.length
}

export async function runReportTaskOutcomeSweep(now = new Date()) {
  return db.transaction(async (tx) => {
    const newlyExpired = await tx
      .update(reportTasks)
      .set({ status: "EXPIRED", updatedAt: now })
      .where(
        and(
          inArray(reportTasks.status, ["PENDING", "SUBMITTED", "RETURNED"]),
          lt(reportTasks.deadline, now),
        ),
      )
      .returning({
        id: reportTasks.id,
        supervisedId: reportTasks.supervisedId,
        scheduleAt: reportTasks.scheduleAt,
      })
    const missingScoreEvents = await tx
      .select({
        id: reportTasks.id,
        supervisedId: reportTasks.supervisedId,
        scheduleAt: reportTasks.scheduleAt,
      })
      .from(reportTasks)
      .leftJoin(
        scoreEvents,
        and(
          eq(scoreEvents.source, "TASK_OUTCOME"),
          eq(scoreEvents.sourceId, reportTasks.id),
        ),
      )
      .where(
        and(
          eq(reportTasks.status, "EXPIRED"),
          lt(reportTasks.deadline, now),
          isNull(scoreEvents.id),
        ),
      )
    const tasks = new Map(
      [...newlyExpired, ...missingScoreEvents].map((task) => [task.id, task]),
    )
    for (const task of tasks.values())
      await recordScoreEvent({
        supervisedId: task.supervisedId,
        points: SCORE_POLICY.taskExpired,
        reason: "任务截止时仍未通过",
        source: "TASK_OUTCOME",
        sourceId: task.id,
        now,
        weekKey: getTaskOutcomeWeekKey(task.scheduleAt),
        executor: tx,
      })
    return newlyExpired.length
  })
}

const schedulerKey = Symbol.for("custodysim.report-task-scheduler")

export function startReportTaskScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [schedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[schedulerKey]) return
  const run = () =>
    void (async () => {
      await ensureScheduledTasks()
      await runLeaveTaskAutoApprovalSweep()
      await runReportTaskOutcomeSweep()
    })().catch((error: unknown) =>
      console.error("[task scheduler] scheduled task generation failed", error),
    )
  run()
  const timer = setInterval(run, 5 * 60 * 1000)
  timer.unref?.()
  runtime[schedulerKey] = timer
}
