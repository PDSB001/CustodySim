import { and, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { enqueueTaskNotifications } from "@/lib/push-server"
import {
  organizations,
  persons,
  reportTemplateFields,
  reportTemplates,
  reportTasks,
  registrations,
  ruleGroupScopes,
  ruleScopes,
  rules,
  scoreEvents,
  taskPools,
  taskPoolTemplates,
  users,
} from "@/lib/db/schema"
import { expandRuleTargets, resolveScopes } from "@/lib/rule-engine"
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
import { reconcileReadingTasks } from "@/lib/reading-server"

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

async function loadTaskContext(userId?: string) {
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
      .select({
        id: users.id,
        organizationId: users.organizationId,
        registeredAt: registrations.createdAt,
      })
      .from(users)
      .leftJoin(registrations, eq(registrations.userId, users.id))
      .where(
        and(
          eq(users.role, "SUPERVISED"),
          eq(users.status, "active"),
          userId ? eq(users.id, userId) : undefined,
        ),
      ),
    db.select().from(reportTemplates),
    db.select().from(reportTemplateFields),
    db.select().from(taskPools).where(eq(taskPools.enabled, true)),
    db.select().from(taskPoolTemplates),
  ])
  const { buildOrgDescendantsMap } = await import("@/lib/supervision-scope")
  const descendants = buildOrgDescendantsMap(allOrganizations)
  const targets = new Map(
    allRules.map((rule) => [
      rule.id,
      expandRuleTargets(
        resolveScopes({
          ownScopes: ownScopes.filter((scope) => scope.ruleId === rule.id),
          groupScopes: rule.ruleGroupId
            ? inheritedScopes.filter(
                (scope) => scope.groupId === rule.ruleGroupId,
              )
            : [],
        }),
        descendants,
        supervisedUsers,
      ),
    ]),
  )
  return {
    allRules,
    supervisedUsers,
    templates,
    templateFields,
    pools,
    poolLinks,
    targets,
    registrationTimes: new Map(
      supervisedUsers.map((user) => [user.id, user.registeredAt]),
    ),
  }
}

type TaskContext = Awaited<ReturnType<typeof loadTaskContext>>

export async function ensureUserTasks(userId: string, now = new Date()) {
  await ensureTasksFromContext(userId, now, await loadTaskContext(userId))
}

async function ensureTasksFromContext(
  userId: string,
  now: Date,
  context: TaskContext,
) {
  const { allRules, templates, templateFields, pools, poolLinks, targets } =
    context
  const supervisorIds = await getSupervisorIdsForSupervised(userId)
  const registeredAt = context.registrationTimes.get(userId)
  for (const rule of allRules) {
    if (!["REPORT", "STUDY", "LABOR"].includes(rule.taskType)) continue
    if (!targets.get(rule.id)?.has(userId)) continue
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
      if (registeredAt && scheduleAt < registeredAt) continue
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
      const requiredMinutes =
        rule.taskType === "STUDY"
          ? rule.readingMinutes || template?.readingMinutes || 0
          : 0
      if (pool && !template && !requiredMinutes) continue
      const templateSnapshot =
        requiredMinutes > 0
          ? {
              name: rule.name,
              kind: "STUDY",
              readingMinutes: requiredMinutes,
              completionMode: "READING",
              fields: [],
            }
          : template
            ? {
                name: template.name,
                kind: template.kind,
                readingMinutes:
                  template.kind === "STUDY" ? template.readingMinutes : 0,
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
  await reconcileReadingTasks(userId, now)
}

export async function ensureScheduledTasks(now = new Date()) {
  // One fresh snapshot per sweep, never reused across requests or permission changes.
  const context = await loadTaskContext()
  for (const user of context.supervisedUsers)
    await ensureTasksFromContext(user.id, now, context)
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
        sql`${reportTasks.templateSnapshot}->>'completionMode' is distinct from 'READING'`,
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
      await enqueueTaskNotifications()
    })().catch((error: unknown) =>
      console.error("[task scheduler] scheduled task generation failed", error),
    )
  run()
  const timer = setInterval(run, 5 * 60 * 1000)
  timer.unref?.()
  runtime[schedulerKey] = timer
}
