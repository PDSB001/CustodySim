import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  autoReviewRuns,
  reportSubmissions,
  reportTasks,
  users,
} from "@/lib/db/schema"
import { prepareAutoReview, manualDecision } from "@/lib/auto-review-policy"
import { GLM_REVIEW_MODEL, reviewWithGlm } from "@/lib/glm-review"
import { applyTaskReview } from "@/lib/task-review"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"
import type { SessionUser } from "@/lib/session"
import { ISOLATION_REPORT_TEMPLATE_NAME } from "@/lib/isolation-report-template"
import { getAutoReviewSettings } from "@/lib/auto-review-settings"

export const autoReviewVersion = sql<string>`${reportTasks.updatedAt}::text || '/' || ${reportSubmissions.updatedAt}::text`

export async function runAutoReviewSweep() {
  const { settings } = await getAutoReviewSettings()
  if (!settings.enabled || !settings.revision) return 0
  const apiKey = process.env.GLM_API_KEY?.trim()
  const { actorId, templateIds } = settings
  if (!apiKey || !actorId || !templateIds.length) return 0
  const [actorRow] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, actorId), eq(users.status, "active")))
  if (
    !actorRow ||
    actorRow.mustChangePassword ||
    !["ADMIN", "SUPERVISOR"].includes(actorRow.role)
  )
    return 0
  const actor = actorRow as SessionUser
  // An interrupted run must fall back to manual review instead of silently retrying.
  await db
    .update(autoReviewRuns)
    .set({
      status: "MANUAL",
      result: "MANUAL",
      reason: "自动审核被中断，请人工审核",
    })
    .where(
      and(
        eq(autoReviewRuns.status, "PROCESSING"),
        lt(autoReviewRuns.createdAt, new Date(Date.now() - 300_000)),
      ),
    )
  const supervisedIds = [...(await getSupervisedUserIdsForActor(actor))]
  if (!supervisedIds.length) return 0
  const candidates = await db
    .select({
      task: reportTasks,
      submission: reportSubmissions,
      version: autoReviewVersion,
    })
    .from(reportTasks)
    .innerJoin(reportSubmissions, eq(reportSubmissions.taskId, reportTasks.id))
    .leftJoin(
      autoReviewRuns,
      and(
        eq(autoReviewRuns.submissionId, reportSubmissions.id),
        eq(autoReviewRuns.inputVersion, autoReviewVersion),
      ),
    )
    .where(
      and(
        inArray(reportTasks.supervisedId, supervisedIds),
        eq(reportTasks.status, "SUBMITTED"),
        eq(reportSubmissions.status, "SUBMITTED"),
        gt(reportTasks.deadline, new Date()),
        inArray(reportTasks.templateId, templateIds),
        isNull(autoReviewRuns.id),
      ),
    )
    .orderBy(asc(reportSubmissions.updatedAt))
    .limit(3)
  let processed = 0
  for (const row of candidates) {
    const currentSettings = (await getAutoReviewSettings()).settings
    if (
      !currentSettings.enabled ||
      currentSettings.revision !== settings.revision
    )
      break
    const [run] = await db
      .insert(autoReviewRuns)
      .values({
        submissionId: row.submission.id,
        inputVersion: row.version,
        model: GLM_REVIEW_MODEL,
      })
      .onConflictDoNothing()
      .returning()
    if (!run) continue
    const payload = row.task.payload as { isReflection?: boolean } | null
    const prepared = prepareAutoReview(
      row.task.templateSnapshot,
      row.submission.data,
      row.task.source === "ISOLATION" ||
        payload?.isReflection === true ||
        (row.task.templateSnapshot as { name?: string })?.name ===
          ISOLATION_REPORT_TEMPLATE_NAME,
    )
    let decision =
      prepared.decision ?? (await reviewWithGlm(prepared.input!, apiKey))
    if (decision.result !== "MANUAL") {
      try {
        // Recheck authorization after the network call, before changing business state.
        const [currentActor] = await db
          .select()
          .from(users)
          .where(eq(users.id, actor.id))
        if (
          !currentActor ||
          currentActor.mustChangePassword ||
          currentActor.status !== "active" ||
          currentActor.role !== actor.role
        )
          throw new Error("actor changed")
        await applyTaskReview(
          actor,
          {
            submissionId: row.submission.id,
            result: decision.result,
            comment: `自动审核：${decision.reason}`,
          },
          {
            task: row.task.updatedAt.toISOString(),
            submission: row.submission.updatedAt.toISOString(),
            input: JSON.stringify([
              row.task.templateSnapshot,
              row.submission.data,
              row.submission.content,
            ]),
            configRevision: settings.revision,
          },
        )
      } catch {
        decision = manualDecision(
          "任务或权限已变化，自动结论未应用，请人工复核",
        )
      }
    }
    await db
      .update(autoReviewRuns)
      .set({
        result: decision.result,
        reason: decision.reason,
        status: decision.result === "MANUAL" ? "MANUAL" : "APPLIED",
      })
      .where(eq(autoReviewRuns.id, run.id))
    processed += 1
  }
  return processed
}

const schedulerKey = Symbol.for("custodysim.auto-review")
export function startAutoReviewScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [schedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[schedulerKey]) return
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await runAutoReviewSweep()
    } catch {
      console.error(
        "[auto-review] sweep failed; manual review remains available",
      )
    } finally {
      running = false
    }
  }
  runtime[schedulerKey] = setInterval(() => void run(), 60_000)
  runtime[schedulerKey].unref?.()
  void run()
}
