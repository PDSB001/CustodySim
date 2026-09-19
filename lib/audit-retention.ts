import { lt } from "drizzle-orm"

import { AUDIT_LOG_RETENTION_DAYS } from "@/lib/constants"
import { db } from "@/lib/db"
import { auditLogs } from "@/lib/db/schema"
import { startIntervalScheduler } from "@/lib/interval-scheduler"

/**
 * 操作审计日志的保留与清理。
 *
 * audit_logs 此前没有任何保留策略：每次管理操作（发布通知、删除人员、修改规则…）
 * 都会写一条，随时间无限增长。保留期取保守的 2 年（AUDIT_LOG_RETENTION_DAYS），
 * 表上已有 audit_logs_created_at_idx，按时间删除走索引。
 *
 * 如需永久留档：不要调用 startAuditLogRetentionScheduler（见 instrumentation.ts），
 * 或把 AUDIT_LOG_RETENTION_DAYS 调大。
 */
export const AUDIT_LOG_CLEANUP_INTERVAL_MS =
  AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function auditLogRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

/** 删除超过保留期的审计日志，返回删除条数。 */
export async function purgeExpiredAuditLogs(now = new Date()) {
  const rows = await db
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, auditLogRetentionCutoff(now)))
    .returning({ id: auditLogs.id })
  return rows.length
}

const schedulerKey = Symbol.for("custodysim.audit-log-retention-scheduler")

export function startAuditLogRetentionScheduler() {
  startIntervalScheduler({
    key: schedulerKey,
    intervalMs: AUDIT_LOG_CLEANUP_INTERVAL_MS,
    label: "audit log retention",
    run: purgeExpiredAuditLogs,
  })
}
