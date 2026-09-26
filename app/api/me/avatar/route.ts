import { eq } from "drizzle-orm"
import { failure, success } from "@/lib/api-response"
import { AVATAR_MAX_BODY, validAvatar } from "@/lib/avatar"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function PATCH(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const reader = request.body?.getReader()
    if (!reader) return failure("VALIDATION_ERROR", "请选择头像", 400)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > AVATAR_MAX_BODY) {
          await reader.cancel()
          return failure("VALIDATION_ERROR", "头像过大，请重新选择", 413)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      return failure("VALIDATION_ERROR", "请求格式不正确", 400)
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("avatar" in body) ||
      (body.avatar !== null && !validAvatar(body.avatar))
    )
      return failure(
        "VALIDATION_ERROR",
        "头像需为不超过 64 KB、512 像素的 JPG 图片",
        400,
      )
    const [updated] = await db
      .update(users)
      .set({ avatar: body.avatar as string | null, updatedAt: new Date() })
      .where(eq(users.id, actor.id))
      .returning({ avatar: users.avatar })
    if (!updated) return failure("NOT_FOUND", "账号不存在", 404)
    return success(updated)
  } catch (error) {
    console.error("[API avatar PATCH]", error)
    return failure("INTERNAL_ERROR", "保存头像失败，请稍后重试", 500)
  }
}
