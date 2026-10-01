import { and, count, eq, gt, isNull, or } from "drizzle-orm"

import { getTodayCheckinRecords } from "@/lib/checkin"
import { db } from "@/lib/db"
import {
  applications,
  noticeReads,
  notices,
  profileRecords,
  reportTasks,
} from "@/lib/db/schema"
import type { SessionUser } from "@/lib/session"
import { ensureUserTasks } from "@/lib/task-engine"

export type HomeOverview = {
  checkins: {
    total: number
    completed: number
    /** Includes upcoming slots today, as well as slots that can be checked in now. */
    pending: number
    /** Missed slots without a completed checkin; pending makeup reviews are excluded. */
    missed: number
  } | null
  tasks: { pending: number; review: number } | null
  applications: { review: number; returned: number } | null
  profiles: {
    draft: number
    returned: number
    review: number
    locked: number
  } | null
  unreadNotices: number
}

type CheckinOverviewSlot = {
  status: string
  recordId?: string | null
  recordStatus?: string | null
}

/** Input comes from the existing today query, after task creation and expiry updates. */
export function summarizeHomeCheckins(
  slots: CheckinOverviewSlot[],
): NonNullable<HomeOverview["checkins"]> {
  const summary = { total: slots.length, completed: 0, pending: 0, missed: 0 }
  for (const slot of slots) {
    const completed =
      [
        "DONE",
        "COMPLETED",
        "ON_TIME",
        "LATE",
        "MAKEUP_APPROVED",
        "SYSTEM_MAKEUP",
        "EXEMPT",
      ].includes(slot.status) ||
      Boolean(
        slot.recordId &&
        ["ON_TIME", "LATE", "MAKEUP", "SYSTEM_MAKEUP"].includes(
          slot.recordStatus ?? "",
        ),
      )
    // A late checkin stays completed while its makeup request is reviewed or rejected.
    if (completed) summary.completed += 1
    else if (slot.status === "PENDING") summary.pending += 1
    else if (["MISSED", "MAKEUP_REJECTED"].includes(slot.status))
      summary.missed += 1
  }
  return summary
}

function totalFor(
  rows: { status: string; total: number }[],
  ...statuses: string[]
) {
  return rows.reduce(
    (total, row) =>
      total + (statuses.includes(row.status) ? Number(row.total) : 0),
    0,
  )
}

/** Counts only the session owner. No record content, images or management-wide metrics. */
export async function getHomeOverview(
  actor: SessionUser,
  now = new Date(),
): Promise<HomeOverview> {
  const unread = db
    .select({ total: count() })
    .from(notices)
    .leftJoin(
      noticeReads,
      and(
        eq(noticeReads.noticeId, notices.id),
        eq(noticeReads.userId, actor.id),
      ),
    )
    .where(
      and(
        eq(notices.published, true),
        or(eq(notices.targetRole, "ALL"), eq(notices.targetRole, actor.role)),
        or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
        isNull(noticeReads.id),
      ),
    )

  if (actor.role !== "SUPERVISED") {
    const rows = await unread
    return {
      checkins: null,
      tasks: null,
      applications: null,
      profiles: null,
      unreadNotices: Number(rows[0]?.total ?? 0),
    }
  }

  const [slots] = await Promise.all([
    getTodayCheckinRecords(actor.id, now),
    ensureUserTasks(actor.id, now),
  ])
  const [taskCounts, applicationCounts, profileCounts, unreadCounts] =
    await Promise.all([
      db
        .select({ status: reportTasks.status, total: count() })
        .from(reportTasks)
        .where(eq(reportTasks.supervisedId, actor.id))
        .groupBy(reportTasks.status),
      db
        .select({ status: applications.status, total: count() })
        .from(applications)
        .where(eq(applications.userId, actor.id))
        .groupBy(applications.status),
      db
        .select({ status: profileRecords.status, total: count() })
        .from(profileRecords)
        .where(eq(profileRecords.userId, actor.id))
        .groupBy(profileRecords.status),
      unread,
    ])

  return {
    checkins: summarizeHomeCheckins(slots),
    tasks: {
      pending: totalFor(taskCounts, "PENDING", "RETURNED"),
      review: totalFor(taskCounts, "SUBMITTED"),
    },
    applications: {
      review: totalFor(applicationCounts, "PENDING_REVIEW"),
      returned: totalFor(applicationCounts, "RETURNED"),
    },
    profiles: {
      draft: totalFor(profileCounts, "DRAFT"),
      returned: totalFor(profileCounts, "RETURNED"),
      review: totalFor(profileCounts, "PENDING_REVIEW"),
      locked: totalFor(profileCounts, "LOCKED"),
    },
    unreadNotices: Number(unreadCounts[0]?.total ?? 0),
  }
}
