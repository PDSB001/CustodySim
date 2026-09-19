import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { notices } from "@/lib/db/schema"

const Params = z.object({ id: z.string().uuid() })
const PatchSchema = z.object({ published: z.boolean() })

/** 下架 / 恢复发布。下架后该通知不再出现在受众的公示列表与未读统计中。 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理通知", 403)
  const params = Params.safeParse(await context.params)
  const parsed = PatchSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "通知参数不合法", 400)
  try {
    const [saved] = await db
      .update(notices)
      .set({
        published: parsed.data.published,
        // 重新发布时刷新发布时间；下架保留原发布时间，便于追溯
        ...(parsed.data.published ? { publishedAt: new Date() } : {}),
        // notices.updatedAt 是 defaultNow()，不会随 UPDATE 自动刷新，需要显式写
        updatedAt: new Date(),
      })
      .where(eq(notices.id, params.data.id))
      .returning()
    if (!saved) return failure("NOT_FOUND", "通知不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: saved.published ? "恢复发布通知" : "下架通知",
      entityType: "notice",
      entityId: saved.id,
      detail: { title: saved.title, targetRole: saved.targetRole },
    })
    return success(saved)
  } catch (error) {
    console.error("[API admin/notices PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

/** 物理删除。notice_reads 上是级联删除，已读记录会一并清除。 */
export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理通知", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [deleted] = await db
      .delete(notices)
      .where(eq(notices.id, params.data.id))
      .returning()
    if (!deleted) return failure("NOT_FOUND", "通知不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除通知",
      entityType: "notice",
      entityId: deleted.id,
      detail: { title: deleted.title, targetRole: deleted.targetRole },
    })
    return success({ id: deleted.id })
  } catch (error) {
    console.error("[API admin/notices DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
