import { and, desc, eq, gte, ilike, lt, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { auditLogs } from "@/lib/db/schema"
import { auditSearchText } from "@/lib/audit-search"
import {
  AuditQuerySchema,
  auditLikePattern,
  parseAuditCursor,
} from "@/lib/audit-query"

export async function GET(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看审计日志", 403)

  const parsed = AuditQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "筛选参数不合法",
      400,
    )
  const { q, actorType, action, entityType, from, to, limit } = parsed.data
  let cursor
  try {
    cursor = parseAuditCursor(parsed.data.cursor)
  } catch {
    return failure("VALIDATION_ERROR", "分页游标不合法，请刷新后重试", 400)
  }
  try {
    const rows = await db
      .select({
        id: auditLogs.id,
        actorName: auditLogs.actorName,
        actorRole: auditLogs.actorRole,
        actorType: auditLogs.actorType,
        action: auditLogs.action,
        actionLabel: auditLogs.actionLabel,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        createdAt: auditLogs.createdAt,
        // Preserve PostgreSQL microseconds; JS Date alone can skip sub-millisecond rows.
        cursorTime: sql<string>`to_char(${auditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(auditLogs)
      .where(
        and(
          q
            ? ilike(auditSearchText(auditLogs), auditLikePattern(q))
            : undefined,
          actorType ? eq(auditLogs.actorType, actorType) : undefined,
          action ? eq(auditLogs.action, action) : undefined,
          entityType ? eq(auditLogs.entityType, entityType) : undefined,
          from
            ? gte(auditLogs.createdAt, new Date(`${from}T00:00:00+08:00`))
            : undefined,
          to
            ? lt(
                auditLogs.createdAt,
                new Date(Date.parse(`${to}T00:00:00+08:00`) + 86400_000),
              )
            : undefined,
          cursor
            ? sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.time}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      // 多取一条用于判断是否还有下一页，不额外发 count 查询
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items.at(-1)

    return success({
      items: items.map((row) => ({
        id: row.id,
        actorName: row.actorName,
        actorRole: row.actorRole,
        actorType: row.actorType,
        action: row.action,
        actionLabel: row.actionLabel,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore && last ? `${last.cursorTime}|${last.id}` : null,
    })
  } catch (error) {
    console.error("[API audit-logs GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
