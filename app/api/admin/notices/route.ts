import { desc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { NoticeSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { notices } from "@/lib/db/schema"

export async function GET() {
  if (!(await getAdminUser())) return failure("FORBIDDEN", "仅管理员可管理通知", 403)
  try {
    return success(await db.select().from(notices).orderBy(desc(notices.createdAt)))
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
