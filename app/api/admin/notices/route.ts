import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { NoticeSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { notices } from "@/lib/db/schema"

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 发布记录列表：游标分页 + 关键词搜索。
 *
 * 通知正文是 text（最长 5000 字），全量返回会让响应体随记录数线性膨胀；
 * 同时通知是持续追加的，offset 分页在翻页期间会重复或漏行（与
 * /api/audit-logs、/api/reviews 保持同一套 (createdAt, id) 游标约定）。
 */
export async function GET(request: NextRequest) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理通知", 403)

  const params = request.nextUrl.searchParams
  const requested = Number(params.get("limit") ?? DEFAULT_PAGE_SIZE)
  const limit = Math.min(
    Math.max(
      Number.isFinite(requested) ? Math.trunc(requested) : DEFAULT_PAGE_SIZE,
      1,
    ),
    MAX_PAGE_SIZE,
  )
  const keyword = (params.get("keyword") ?? "").trim().slice(0, 100)

  const [cursorTime, cursorId] = (params.get("cursor") ?? "").split("|")
  const cursorDate = cursorTime ? new Date(cursorTime) : null
  const hasCursor =
    cursorDate !== null &&
    !Number.isNaN(cursorDate.getTime()) &&
    UUID_PATTERN.test(cursorId ?? "")

  // 只对标题与正文做模糊匹配；关键字由 drizzle 绑定参数，不存在拼接注入。
  const keywordWhere = keyword
    ? or(
        ilike(notices.title, `%${keyword}%`),
        ilike(notices.content, `%${keyword}%`),
      )
    : undefined
  const cursorWhere = hasCursor
    ? or(
        lt(notices.createdAt, cursorDate),
        and(
          eq(notices.createdAt, cursorDate),
          lt(notices.id, sql`${cursorId}::uuid`),
        ),
      )
    : undefined
  const where =
    keywordWhere && cursorWhere
      ? and(keywordWhere, cursorWhere)
      : (keywordWhere ?? cursorWhere)

  try {
    const rows = await db
      .select()
      .from(notices)
      .where(where)
      .orderBy(desc(notices.createdAt), desc(notices.id))
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
  } catch (error) {
    console.error("[API admin/notices GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理通知", 403)
  const parsed = NoticeSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "通知参数不合法", 400)
  try {
    const [saved] = await db
      .insert(notices)
      .values({
        ...parsed.data,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        publishedAt: parsed.data.published ? new Date() : null,
        createdBy: actor.id,
      })
      .returning()
    if (!saved) return failure("INTERNAL_ERROR", "发布通知失败", 500)
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: parsed.data.published ? "发布通知" : "保存通知草稿",
      entityType: "notice",
      entityId: saved.id,
      detail: { title: saved.title, targetRole: saved.targetRole },
    })
    return success(saved, { status: 201 })
  } catch (error) {
    console.error("[API admin/notices POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
