import { and, eq, lt, or } from "drizzle-orm"

import { NOTICE_RETENTION_DAYS } from "@/lib/constants"
import { db } from "@/lib/db"
import { notices } from "@/lib/db/schema"
import { startIntervalScheduler } from "@/lib/interval-scheduler"

/**
 * 监所通知的保留与清理。
 *
 * 背景：notices 表此前没有任何保留策略，也没有删除入口，
 * 发布出去的通知（含 notice_reads 已读记录）会无限期堆积。
 * 这里与聊天审计清理（lib/chat.ts + scripts/cleanup-chat.ts）保持同一套做法：
 * 保留期 = 3 个月，超期记录连同已读记录一起物理删除（notice_reads 上配置了级联删除）。
 */
export const NOTICE_CLEANUP_INTERVAL_MS =
  NOTICE_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function noticeRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - NOTICE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * 删除超过保留期的通知，返回删除条数。
 *
 * 已发布与未发布分开判断，避免把"编辑中的草稿"当成过期公示删掉：
 * - 已发布：按 createdAt 计保留期（公示存在多久）；
 * - 未发布：按 updatedAt 计（被放弃超过保留期的草稿才清理，编辑中的不会）。
 */
export async function purgeExpiredNotices(now = new Date()) {
  const cutoff = noticeRetentionCutoff(now)
  const rows = await db
    .delete(notices)
    .where(
      or(
        and(eq(notices.published, true), lt(notices.createdAt, cutoff)),
        and(eq(notices.published, false), lt(notices.updatedAt, cutoff)),
      ),
    )
    .returning({ id: notices.id })
  return rows.length
}

const schedulerKey = Symbol.for("custodysim.notice-retention-scheduler")

export function startNoticeRetentionScheduler() {
  startIntervalScheduler({
    key: schedulerKey,
    intervalMs: NOTICE_CLEANUP_INTERVAL_MS,
    label: "notice retention",
    run: purgeExpiredNotices,
  })
}
