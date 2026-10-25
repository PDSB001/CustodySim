import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getChatConversationAccess } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { chatNotificationPreferences } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  const input = z
    .object({ muted: z.boolean() })
    .safeParse(await request.json().catch(() => null))
  if (!id.success || !input.success)
    return failure("VALIDATION_ERROR", "通知设置不合法", 400)
  if (!(await getChatConversationAccess(actor, id.data)))
    return failure("NOT_FOUND", "会话不存在", 404)
  try {
    await db
      .insert(chatNotificationPreferences)
      .values({
        userId: actor.id,
        conversationId: id.data,
        muted: input.data.muted,
      })
      .onConflictDoUpdate({
        target: [
          chatNotificationPreferences.userId,
          chatNotificationPreferences.conversationId,
        ],
        set: { muted: input.data.muted },
      })
    return success({ muted: input.data.muted })
  } catch {
    return failure("INTERNAL_ERROR", "保存免打扰设置失败", 500)
  }
}
