import { and, desc, eq, lt, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { auditLogs } from "@/lib/db/schema"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看审计日志", 403)

  const params = request.nextUrl.searchParams
  const requested = Number(params.get("limit") ?? DEFAULT_PAGE_SIZE)
  const limit = Math.min(
    Math.max(
      Number.isFinite(requested) ? Math.trunc(requested) : DEFAULT_PAGE_SIZE,
      1,
    ),
    MAX_PAGE_SIZE,
  )

  /*
   * 游标分页：游标是上一页最后一条的 createdAt|id。
   * 审计记录是持续追加的，用 offset 分页会在翻页期间出现重复或漏行；
   * 按 (createdAt, id) 降序继续取，翻页结果稳定。
   */
  const [cursorTime, cursorId] = (params.get("cursor") ?? "").split("|")
  const cursorDate = cursorTime ? new Date(cursorTime) : null
  const hasCursor =
    cursorDate !== null &&
    !Number.isNaN(cursorDate.getTime()) &&
    UUID_PATTERN.test(cursorId ?? "")

  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      hasCursor
        ? or(
            lt(auditLogs.createdAt, cursorDate),
            and(
              eq(auditLogs.createdAt, cursorDate),
              lt(auditLogs.id, sql`${cursorId}::uuid`),
            ),
          )
        : undefined,
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    // 多取一条用于判断是否还有下一页，不额外发 count 查询
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)

  return success({
    items,
    nextCursor:
      hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  })
}
