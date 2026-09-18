import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  autoReviewSettings,
  notices,
  reportReviews,
  reportSubmissions,
  reportTasks,
  users,
} from "@/lib/db/schema"
import { getOfficialSealData } from "@/lib/seal-server"
import type { SessionUser } from "@/lib/session"
import { SYSTEM_AI_ACTOR } from "@/lib/system-identity"
import {
  getTaskOutcomeWeekKey,
  getTaskOutcomeScoreDelta,
  recordScoreEvent,
} from "@/lib/scoring"
import { isEffectiveSupervisorForSupervised } from "@/lib/supervision-scope"
import { ISOLATION_REPORT_TEMPLATE_NAME } from "@/lib/isolation-report-template"

const ReviewSchema = z.object({
  submissionId: z.string().uuid(),
  result: z.enum(["APPROVED", "RETURNED"]),
  grade: z.coerce.number().int().min(0).max(100).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
})

export class ReviewConflictError extends Error {}

function formatReflectionBroadcast(data: unknown, content: string) {
  if (typeof data === "object" && data && !Array.isArray(data)) {
    const text = Object.entries(data)
      .filter(
        ([, value]) => typeof value === "string" || typeof value === "number",
      )
      .map(([key, value]) => `${key}：${String(value)}`)
      .join("\n")
      .trim()
    if (text) return text.slice(0, 4800)
  }
  return content.slice(0, 4800)
}

export async function applyTaskReview(
  actor: SessionUser,
  input: z.infer<typeof ReviewSchema>,
  expectedVersion?: {
    task: string
    submission: string
    input: string
    configRevision?: string
  },
) {
  const parsed = ReviewSchema.safeParse(input)
  if (!parsed.success || actor.role === "SUPERVISED")
    throw new ReviewConflictError("无审核权限或参数不合法")
  // 携带配置版本号的调用来自自动审核；此时权限仍按监管账号校验，但业务身份记为系统级 AI。
  const automated = Boolean(expectedVersion?.configRevision)
  const [row] = await db
    .select({
      taskId: reportTasks.id,
      supervisedId: reportTasks.supervisedId,
      templateSnapshot: reportTasks.templateSnapshot,
      taskStatus: reportTasks.status,
      taskUpdatedAt: reportTasks.updatedAt,
      submissionUpdatedAt: reportSubmissions.updatedAt,
      scheduleAt: reportTasks.scheduleAt,
      deadline: reportTasks.deadline,
      taskSource: reportTasks.source,
      taskPayload: reportTasks.payload,
      submissionContent: reportSubmissions.content,
      submissionData: reportSubmissions.data,
      supervisedName: users.name,
    })
    .from(reportSubmissions)
    .innerJoin(reportTasks, eq(reportTasks.id, reportSubmissions.taskId))
    .innerJoin(users, eq(users.id, reportTasks.supervisedId))
    .where(eq(reportSubmissions.id, parsed.data.submissionId))
    .limit(1)
  if (
    !row ||
    !(await isEffectiveSupervisorForSupervised(actor, row.supervisedId))
  )
    throw new ReviewConflictError("不在监管范围内")
  if (row.taskStatus !== "SUBMITTED")
    throw new ReviewConflictError("任务当前不可审核")
  if (row.deadline < new Date())
    throw new ReviewConflictError("任务已超过截止时间")
  if (
    expectedVersion &&
    (row.taskUpdatedAt.toISOString() !== expectedVersion.task ||
      row.submissionUpdatedAt.toISOString() !== expectedVersion.submission ||
      JSON.stringify([
        row.templateSnapshot,
        row.submissionData,
        row.submissionContent,
      ]) !== expectedVersion.input)
  )
    throw new ReviewConflictError("审核内容已更新")
  const taskKind =
    typeof row.templateSnapshot === "object" && row.templateSnapshot
      ? (row.templateSnapshot as { kind?: string }).kind
      : undefined
  const officialSealData =
    parsed.data.result === "APPROVED"
      ? await getOfficialSealData(taskKind === "REPORT" ? "REPORT" : "TASK")
      : null
  const isReflectionTask =
    typeof row.taskPayload === "object" &&
    row.taskPayload !== null &&
    ((row.taskPayload as { isReflection?: boolean }).isReflection === true ||
      (typeof row.templateSnapshot === "object" &&
        row.templateSnapshot !== null &&
        (row.templateSnapshot as { name?: string }).name ===
          ISOLATION_REPORT_TEMPLATE_NAME))
  let outcome
  try {
    outcome = await db.transaction(async (tx) => {
      if (expectedVersion?.configRevision) {
        const [settings] = await tx
          .select()
          .from(autoReviewSettings)
          .where(eq(autoReviewSettings.id, "default"))
          .for("share")
        if (
          !settings?.enabled ||
          settings.revision !== expectedVersion.configRevision ||
          settings.actorId !== actor.id
        ) {
          throw new ReviewConflictError("自动审核设置已变化")
        }
      }
      const [lockedTask] = await tx
        .select()
        .from(reportTasks)
        .where(eq(reportTasks.id, row.taskId))
        .for("update")
      const [lockedSubmission] = await tx
        .select()
        .from(reportSubmissions)
        .where(eq(reportSubmissions.id, parsed.data.submissionId))
      const now = new Date()
      if (
        !lockedTask ||
        !lockedSubmission ||
        lockedSubmission.updatedAt.getTime() !==
          row.submissionUpdatedAt.getTime() ||
        JSON.stringify(lockedSubmission.data) !==
          JSON.stringify(row.submissionData) ||
        lockedSubmission.content !== row.submissionContent ||
        JSON.stringify(lockedTask.templateSnapshot) !==
          JSON.stringify(row.templateSnapshot) ||
        lockedTask.status !== "SUBMITTED" ||
        lockedTask.supervisedId !== row.supervisedId ||
        lockedTask.updatedAt.getTime() !== row.taskUpdatedAt.getTime() ||
        lockedTask.scheduleAt > now ||
        lockedTask.deadline < now
      )
        throw new ReviewConflictError()
      const [updatedTask] = await tx
        .update(reportTasks)
        .set({
          status: parsed.data.result === "APPROVED" ? "APPROVED" : "RETURNED",
          updatedAt: now,
        })
        .where(
          and(
            eq(reportTasks.id, row.taskId),
            eq(reportTasks.status, "SUBMITTED"),
          ),
        )
        .returning({ id: reportTasks.id })
      if (!updatedTask) throw new ReviewConflictError()
      const [createdReview] = await tx
        .insert(reportReviews)
        .values({
          ...parsed.data,
          reviewerId: automated ? null : actor.id,
          submissionId: parsed.data.submissionId,
        })
        .returning()
      if (!createdReview) throw new Error("审核记录创建失败")
      if (officialSealData)
        await tx
          .update(reportSubmissions)
          .set({ officialSealData, updatedAt: now })
          .where(eq(reportSubmissions.id, parsed.data.submissionId))
      let scoreDelta = 0
      if (parsed.data.result === "APPROVED") {
        const priorReturns = await tx
          .select({ id: reportReviews.id })
          .from(reportReviews)
          .where(
            and(
              eq(reportReviews.submissionId, parsed.data.submissionId),
              eq(reportReviews.result, "RETURNED"),
            ),
          )
        scoreDelta = getTaskOutcomeScoreDelta({
          returnedBeforeApproval: priorReturns.length > 0,
        })
        await recordScoreEvent({
          supervisedId: row.supervisedId,
          points: scoreDelta,
          reason:
            priorReturns.length > 0 ? "任务打回后按时通过" : "任务首次按时通过",
          source: "TASK_OUTCOME",
          sourceId: row.taskId,
          operatorId: automated ? null : actor.id,
          weekKey: getTaskOutcomeWeekKey(row.scheduleAt),
          executor: tx,
        })
      }
      if (isReflectionTask && parsed.data.result === "APPROVED")
        await tx.insert(notices).values({
          title: `禁闭检讨汇报 · ${row.supervisedName}`,
          content: formatReflectionBroadcast(
            row.submissionData,
            row.submissionContent,
          ),
          targetRole: "ALL",
          priority: "IMPORTANT",
          published: true,
          publishedAt: now,
          createdBy: actor.id,
        })
      await writeAuditLog(
        {
          actor: automated ? SYSTEM_AI_ACTOR : actor,
          action: "REVIEW",
          actionLabel:
            parsed.data.result === "APPROVED" ? "审核通过任务" : "退回任务",
          entityType: "report_submission",
          entityId: parsed.data.submissionId,
          detail: {
            automated,
            actorType: automated ? "SYSTEM_AI" : "USER",
            result: parsed.data.result,
            grade: parsed.data.grade ?? null,
            scoreDelta,
            broadcast: isReflectionTask && parsed.data.result === "APPROVED",
          },
        },
        tx,
      )
      return { review: createdReview, scoreDelta }
    })
  } catch (error) {
    if (error instanceof ReviewConflictError) throw error
    throw error
  }
  return outcome.review
}
