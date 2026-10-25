import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { noticeReads, notices } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const ReadSchema = z
  .object({
    noticeId: z.string().uuid().optional(),
    noticeIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    versions: z.record(z.string().uuid(), z.string().datetime()).optional(),
  })
  .refine((data) => Boolean(data.noticeId) !== Boolean(data.noticeIds))

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
  const keyword = (params.get("keyword") ?? "").trim().slice(0, 100)
  const priority = params.get("priority")
  const visible = and(
    eq(notices.published, true),
    or(eq(notices.targetRole, "ALL"), eq(notices.targetRole, actor.role)),
    or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
    keyword
      ? or(
          ilike(notices.title, `%${keyword}%`),
          ilike(notices.content, `%${keyword}%`),
        )
      : undefined,
    priority && ["NORMAL", "IMPORTANT", "URGENT"].includes(priority)
      ? eq(notices.priority, priority)
      : undefined,
    params.get("unread") === "1" ? isNull(noticeReads.id) : undefined,
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
        updatedAt: notices.updatedAt,
        metadata: notices.metadata,
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
  const parsed = ReadSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "通知参数不合法", 400)
  try {
    const ids = [...new Set(parsed.data.noticeIds ?? [parsed.data.noticeId!])]
    const result = await db.transaction(async (tx) => {
      const visible = await tx
        .select({ id: notices.id, updatedAt: notices.updatedAt })
        .from(notices)
        .where(
          and(
            inArray(notices.id, ids),
            eq(notices.published, true),
            or(
              eq(notices.targetRole, "ALL"),
              eq(notices.targetRole, actor.role),
            ),
            or(isNull(notices.expiresAt), gt(notices.expiresAt, new Date())),
          ),
        )
        .orderBy(notices.id)
        .for("update")
      if (visible.length !== ids.length) return "NOT_FOUND" as const
      if (
        visible.some(
          (notice) =>
            parsed.data.versions?.[notice.id] &&
            parsed.data.versions[notice.id] !== notice.updatedAt.toISOString(),
        )
      )
        return "CONFLICT" as const
      await tx
        .insert(noticeReads)
        .values(
          visible.map((notice) => ({ noticeId: notice.id, userId: actor.id })),
        )
        .onConflictDoNothing()
      return "OK" as const
    })
    if (result === "NOT_FOUND")
      return failure("NOT_FOUND", "通知不存在、已过期或不可阅读", 404)
    if (result === "CONFLICT")
      return failure("CONFLICT", "通知已更新，请刷新后重新阅读", 409)
    return success({ id: ids[0], ids, read: true })
  } catch (error) {
    console.error("[API notices PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
