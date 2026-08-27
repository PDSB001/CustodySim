import { and, desc, eq, gt, isNull, or } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { noticeReads, notices } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const ReadSchema = z.object({ noticeId: z.string().uuid() })

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const now = new Date()
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
        and(eq(noticeReads.noticeId, notices.id), eq(noticeReads.userId, actor.id)),
      )
      .where(
        and(
          eq(notices.published, true),
          or(eq(notices.targetRole, "ALL"), eq(notices.targetRole, actor.role)),
          or(isNull(notices.expiresAt), gt(notices.expiresAt, now)),
        ),
      )
      .orderBy(desc(notices.publishedAt), desc(notices.createdAt))
    return success(rows)
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
