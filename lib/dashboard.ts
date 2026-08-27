import { and, count, eq, gt, gte, inArray, lt, ne } from "drizzle-orm"

import { getDayRange } from "@/lib/checkin"
import { getCustodyProfileForUser } from "@/lib/custody-checkin"
import { PRISONER_CUSTODY_STATUS_LABELS } from "@/lib/constants"
import { db } from "@/lib/db"
import {
  checkinMakeups,
  checkinTasks,
  persons,
  reportTasks,
  rules,
} from "@/lib/db/schema"
import type { SessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"

export type DashboardSummary = {
  /** 待审核的任务（监管范围内已提交） */
  pendingTasks: number
  /** 待审核的补卡申请（监管范围内） */
  pendingMakeups: number
  /** 待打卡时段（本人今日未过期） */
  pendingCheckins: number
  /** 待完成任务（被监管人本人未提交） */
  myPendingTasks: number
  /** 在押人员总数（管理员） */
  inCustodyPersons: number
  /** 已启用的非打卡规则数（管理员） */
  enabledRules: number
  /** 档案状态文本（被监管人） */
  custodyStatus: string
}

export async function getDashboardSummary(
  actor: SessionUser,
  now = new Date(),
): Promise<DashboardSummary> {
  const ids = [...(await getSupervisedUserIdsForActor(actor))]
  const { start, end } = getDayRange(now)

  const [
    scopedTasks,
    scopedMakeups,
    pendingCheckins,
    myPendingTasks,
    inCustodyPersons,
    enabledRules,
  ] = await Promise.all([
    ids.length
      ? db
          .select({ n: count() })
          .from(reportTasks)
          .where(
            and(
              eq(reportTasks.status, "SUBMITTED"),
              inArray(reportTasks.supervisedId, ids),
            ),
          )
      : Promise.resolve([{ n: 0 }]),
    ids.length
      ? db
          .select({ n: count() })
          .from(checkinMakeups)
          .where(
            and(
              eq(checkinMakeups.status, "PENDING"),
              inArray(checkinMakeups.userId, ids),
            ),
          )
      : Promise.resolve([{ n: 0 }]),
    db
      .select({ n: count() })
      .from(checkinTasks)
      .where(
        and(
          eq(checkinTasks.supervisedId, actor.id),
          eq(checkinTasks.status, "PENDING"),
          gte(checkinTasks.scheduleAt, start),
          lt(checkinTasks.scheduleAt, end),
          gt(checkinTasks.deadline, now),
        ),
      ),
    db
      .select({ n: count() })
      .from(reportTasks)
      .where(
        and(
          eq(reportTasks.supervisedId, actor.id),
          eq(reportTasks.status, "PENDING"),
        ),
      ),
    db
      .select({ n: count() })
      .from(persons)
      .where(eq(persons.custodyStatus, "IN_CUSTODY")),
    db
      .select({ n: count() })
      .from(rules)
      .where(and(eq(rules.enabled, true), ne(rules.type, "CHECKIN"))),
  ])

  let custodyStatus = "未知"
  if (actor.role === "SUPERVISED") {
    const profile = await getCustodyProfileForUser(actor.id)
    custodyStatus = profile
      ? PRISONER_CUSTODY_STATUS_LABELS[profile.custodyStatus]
      : "未知"
  }

  return {
    pendingTasks: scopedTasks[0]?.n ?? 0,
    pendingMakeups: scopedMakeups[0]?.n ?? 0,
    pendingCheckins: pendingCheckins[0]?.n ?? 0,
    myPendingTasks: myPendingTasks[0]?.n ?? 0,
    inCustodyPersons: inCustodyPersons[0]?.n ?? 0,
    enabledRules: enabledRules[0]?.n ?? 0,
    custodyStatus,
  }
}
