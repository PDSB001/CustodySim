import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { auditLogs, autoReviewMakeupRuns } from "@/lib/db/schema"
import { isMissingAutoReviewStorage } from "@/lib/auto-review-settings"

/** Enrich only the makeups already selected by the caller's supervision scope. */
export async function withMakeupReviewHistory<
  T extends { id: string; status: string; createdAt: Date },
>(makeups: T[]) {
  if (!makeups.length) return []
  const ids = makeups.map((makeup) => makeup.id)
  const [runs, reviews] = await Promise.all([
    db
      .select({
        id: autoReviewMakeupRuns.id,
        makeupId: autoReviewMakeupRuns.makeupId,
        status: autoReviewMakeupRuns.status,
        result: autoReviewMakeupRuns.result,
        reason: autoReviewMakeupRuns.reason,
        model: autoReviewMakeupRuns.model,
        createdAt: autoReviewMakeupRuns.createdAt,
      })
      .from(autoReviewMakeupRuns)
      .where(inArray(autoReviewMakeupRuns.makeupId, ids))
      .orderBy(
        desc(autoReviewMakeupRuns.createdAt),
        desc(autoReviewMakeupRuns.id),
      )
      .catch((error: unknown) => {
        // Older deployments must keep their manual review queue available.
        if (isMissingAutoReviewStorage(error)) return []
        throw error
      }),
    db
      .select({
        id: auditLogs.id,
        makeupId: auditLogs.entityId,
        actorName: auditLogs.actorName,
        actorType: auditLogs.actorType,
        detail: auditLogs.detail,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "checkin_makeup"),
          eq(auditLogs.action, "REVIEW"),
          inArray(auditLogs.entityId, ids),
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)),
  ])

  const runsByMakeup = new Map<string, typeof runs>()
  for (const run of runs) {
    const group = runsByMakeup.get(run.makeupId) ?? []
    group.push(run)
    runsByMakeup.set(run.makeupId, group)
  }
  const reviewsByMakeup = new Map<string | null, typeof reviews>()
  for (const review of reviews) {
    const group = reviewsByMakeup.get(review.makeupId) ?? []
    group.push(review)
    reviewsByMakeup.set(review.makeupId, group)
  }
  return makeups.map((makeup) => {
    const autoReviewHistory = (runsByMakeup.get(makeup.id) ?? []).map(
      (run) => ({
        id: run.id,
        status: run.status,
        result: run.result,
        reason: run.reason,
        model: run.model,
        createdAt: run.createdAt,
        isCurrent: run.createdAt.getTime() >= makeup.createdAt.getTime(),
      }),
    )
    const currentRun = autoReviewHistory.find((run) => run.isCurrent)
    const reviewHistory = (reviewsByMakeup.get(makeup.id) ?? []).flatMap(
      (review) => {
        const detail = review.detail as Record<string, unknown> | null
        if (detail?.result !== "APPROVED" && detail?.result !== "REJECTED")
          return []
        return [
          {
            id: review.id,
            actorName: review.actorName,
            actorType: review.actorType,
            result: detail.result,
            comment: typeof detail.comment === "string" ? detail.comment : null,
            createdAt: review.createdAt,
            isCurrent: review.createdAt.getTime() >= makeup.createdAt.getTime(),
          },
        ]
      },
    )
    return {
      ...makeup,
      autoReviewReason:
        makeup.status === "PENDING" && currentRun?.status === "MANUAL"
          ? currentRun.reason
          : null,
      autoReviewHistory,
      reviewHistory,
    }
  })
}
