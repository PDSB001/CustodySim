import { createHash } from "node:crypto"
import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  autoReviewRuns,
  autoReviewMakeupRuns,
  checkinMakeups,
  reportSubmissions,
  reportTasks,
  users,
} from "@/lib/db/schema"
import { prepareAutoReview, manualDecision } from "@/lib/auto-review-policy"
import { reviewWithGlm } from "@/lib/glm-review"
import { acquireGlmReviewConcurrencySlot } from "@/lib/glm-review-concurrency"
import { getGlmReviewConfig } from "@/lib/glm-review-config"
import { applyTaskReview } from "@/lib/task-review"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"
import type { SessionUser } from "@/lib/session"
import { ISOLATION_REPORT_TEMPLATE_NAME } from "@/lib/isolation-report-template"
import { getAutoReviewSettings } from "@/lib/auto-review-settings"
import { reviewCheckinMakeup } from "@/lib/checkin"

export const autoReviewVersion = sql<string>`${reportTasks.updatedAt}::text || '/' || ${reportSubmissions.updatedAt}::text`
// A sweep can issue up to three task reviews and three makeup reviews serially.
// Keep interrupted-run recovery beyond their combined 6-minute request budget.
const staleReviewRunMs = 10 * 60_000

export async function runAutoReviewSweep() {
  const { settings } = await getAutoReviewSettings()
  if ((!settings.enabled && !settings.makeupEnabled) || !settings.revision)
    return 0
  const config = getGlmReviewConfig(process.env, settings.provider)
  const apiKey = config.apiKey
  const { actorId, templateIds } = settings
  if (!apiKey || !actorId || (settings.enabled && !templateIds.length)) return 0
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
  if (settings.enabled)
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
          lt(autoReviewRuns.createdAt, new Date(Date.now() - staleReviewRunMs)),
        ),
      )
  const supervisedIds = [...(await getSupervisedUserIdsForActor(actor))]
  if (!supervisedIds.length) return 0
  const candidates = settings.enabled
    ? await db
        .select({
          task: reportTasks,
          submission: reportSubmissions,
          version: autoReviewVersion,
        })
        .from(reportTasks)
        .innerJoin(
          reportSubmissions,
          eq(reportSubmissions.taskId, reportTasks.id),
        )
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
    : []
  let processed = 0
  for (const row of candidates) {
    const currentSettings = (await getAutoReviewSettings()).settings
    if (
      !currentSettings.enabled ||
      currentSettings.revision !== settings.revision
    )
      break
    const payload = row.task.payload as { isReflection?: boolean } | null
    const prepared = prepareAutoReview(
      row.task.templateSnapshot,
      row.submission.data,
      row.task.source === "ISOLATION" ||
        payload?.isReflection === true ||
        (row.task.templateSnapshot as { name?: string })?.name ===
          ISOLATION_REPORT_TEMPLATE_NAME,
    )
    const releaseSlot = prepared.decision
      ? null
      : await acquireGlmReviewConcurrencySlot(config)
    if (!prepared.decision && !releaseSlot) break
    let run: typeof autoReviewRuns.$inferSelect | undefined
    try {
      const inserted = await db
        .insert(autoReviewRuns)
        .values({
          submissionId: row.submission.id,
          inputVersion: row.version,
          model: config.model,
        })
        .onConflictDoNothing()
        .returning()
      run = inserted[0]
    } catch (error) {
      await releaseSlot?.()
      throw error
    }
    if (!run) {
      await releaseSlot?.()
      continue
    }
    let decision = prepared.decision
    if (!decision) {
      try {
        decision = await reviewWithGlm(prepared.input!, apiKey, config)
      } finally {
        await releaseSlot?.()
      }
    }
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
  if (settings.makeupEnabled) {
    await db
      .update(autoReviewMakeupRuns)
      .set({
        status: "MANUAL",
        result: "MANUAL",
        reason: "自动审核被中断，请人工审核",
      })
      .where(
        and(
          eq(autoReviewMakeupRuns.status, "PROCESSING"),
          lt(
            autoReviewMakeupRuns.createdAt,
            new Date(Date.now() - staleReviewRunMs),
          ),
        ),
      )
    const makeups = await db
      .select()
      .from(checkinMakeups)
      .where(
        and(
          inArray(checkinMakeups.userId, supervisedIds),
          eq(checkinMakeups.status, "PENDING"),
        ),
      )
      .orderBy(asc(checkinMakeups.createdAt))
      .limit(3)
    for (const makeup of makeups) {
      const currentSettings = (await getAutoReviewSettings()).settings
      if (
        !currentSettings.makeupEnabled ||
        currentSettings.revision !== settings.revision
      )
        break
      const inputVersion = createHash("sha256")
        .update(
          JSON.stringify([
            makeup.reason,
            makeup.photoUrl,
            makeup.ruleId,
            makeup.date,
            makeup.slotIndex,
          ]),
        )
        .digest("hex")
      const prepared = makeup.photoUrl
        ? { decision: manualDecision("补卡包含图片凭证，请人工核验") }
        : prepareAutoReview(
            {
              content:
                "清楚说明漏打卡的具体原因，并解释补打卡的必要性。只判断理由文字是否完整、明确、切题；不核实线下事实真伪，不要求额外证据。理由空泛、无关或无法判断时转人工，不得仅因无法核验事实而驳回。",
              fields: [
                {
                  name: "补卡原因",
                  type: "TEXTAREA",
                  required: true,
                  options: [],
                },
              ],
            },
            { 补卡原因: makeup.reason },
            false,
          )
      const releaseSlot = prepared.decision
        ? null
        : await acquireGlmReviewConcurrencySlot(config)
      if (!prepared.decision && !releaseSlot) break
      let run: typeof autoReviewMakeupRuns.$inferSelect | undefined
      try {
        const inserted = await db
          .insert(autoReviewMakeupRuns)
          .values({
            makeupId: makeup.id,
            inputVersion,
            model: config.model,
          })
          .onConflictDoNothing()
          .returning()
        run = inserted[0]
      } catch (error) {
        await releaseSlot?.()
        throw error
      }
      if (!run) {
        await releaseSlot?.()
        continue
      }
      let decision = prepared.decision
      if (!decision) {
        try {
          decision = await reviewWithGlm(prepared.input!, apiKey, config)
        } finally {
          await releaseSlot?.()
        }
      }
      if (decision.result === "APPROVED" || decision.result === "RETURNED") {
        try {
          const [currentActor] = await db
            .select()
            .from(users)
            .where(eq(users.id, actor.id))
          if (
            !currentActor ||
            currentActor.mustChangePassword ||
            currentActor.status !== "active" ||
            currentActor.role !== actor.role ||
            (await getAutoReviewSettings()).settings.revision !==
              settings.revision
          )
            throw new Error("reviewer or settings changed")
          await reviewCheckinMakeup({
            actor,
            makeupId: makeup.id,
            result: decision.result === "APPROVED" ? "APPROVED" : "REJECTED",
            comment: `自动审核：${decision.reason}`,
            automated: true,
          })
        } catch {
          decision = manualDecision("补卡状态或权限已变化，请人工复核")
        }
      }
      await db
        .update(autoReviewMakeupRuns)
        .set({
          result: decision.result,
          reason: decision.reason,
          status: decision.result === "MANUAL" ? "MANUAL" : "APPLIED",
        })
        .where(eq(autoReviewMakeupRuns.id, run.id))
      processed += 1
    }
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
