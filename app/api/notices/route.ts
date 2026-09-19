import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { noticeReads, notices } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const ReadSchema = z.object({ noticeId: z.string().uuid() })

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 受众侧公示列表：游标分页，避免一次把全部通知正文回传。
 *
 * 排序用 (createdAt, id)：publishedAt 可空，用它做游标会让历史 null 行在翻页时消失。
 * 代价是「重新发布」的旧通知仍按创建时间排在原位，不跳到最前。
 */
export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)

  const params = request.nextUrl.searchParams
  const requested = Number(params.get("limit") ?? DEFAULT_PAGE_SIZE)
  const limit = Math.min(
    Math.max(
      Number.isFinite(requested) ? Math.trunc(requested) : DEFAULT_PAGE_SIZE,
      1,
    ),
    MAX_PAGE_SIZE,
  )
  const [cursorTime, cursorId] = (params.get("cursor") ?? "").split("|")
  const cursorDate = cursorTime ? new Date(cursorTime) : null
  const hasCursor =
    cursorDate !== null &&
    !Number.isNaN(cursorDate.getTime()) &&
    UUID_PATTERN.test(cursorId ?? "")

  const now = new Date()
  const visible = and(
    eq(notices.published, true),
    or(eq(notices.targetRole, "ALL"), eq(notices.targetRole, actor.role)),
    or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
  )
  const cursorWhere = hasCursor
    ? or(
        lt(notices.createdAt, cursorDate),
        and(
          eq(notices.createdAt, cursorDate),
          lt(notices.id, sql`${cursorId}::uuid`),
        ),
      )
    : undefined
  const where = cursorWhere ? and(visible, cursorWhere) : visible

  try {
    const rows = await db
      .select({
        id: notices.id,
        title: notices.title,
        content: notices.content,
        targetRole: notices.targetRole,
        priority: notices.priority,
        publishedAt: notices.publishedAt,
        expiresAt: notices.expiresAt,
        createdAt: notices.createdAt,
        readAt: noticeReads.readAt,
      })
      .from(notices)
      .leftJoin(
        noticeReads,
        and(
          eq(noticeReads.noticeId, notices.id),
          eq(noticeReads.userId, actor.id),
        ),
      )
      .where(where)
      .orderBy(desc(notices.createdAt), desc(notices.id))
      // 多取一条用于判断是否还有下一页
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
    console.error("[API notices GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function PATCH(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = ReadSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "通知参数不合法", 400)
  try {
    const [notice] = await db
      .select({ id: notices.id })
      .from(notices)
      .where(
        and(
          eq(notices.id, parsed.data.noticeId),
          eq(notices.published, true),
          or(eq(notices.targetRole, "ALL"), eq(notices.targetRole, actor.role)),
        ),
      )
      .limit(1)
    if (!notice) return failure("NOT_FOUND", "通知不存在或不可阅读", 404)
    await db
      .insert(noticeReads)
      .values({ noticeId: notice.id, userId: actor.id })
      .onConflictDoNothing()
    return success({ id: notice.id, read: true })
  } catch (error) {
    console.error("[API notices PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
