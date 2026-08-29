import { failure, success } from "@/lib/api-response"
import { signChatRealtimeToken } from "@/lib/auth"
import { ChatRealtimeTokenSchema } from "@/lib/chat"
import { getChatConversationAccess } from "@/lib/chat-server"
import { getSessionUser } from "@/lib/session"

export async function POST(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = ChatRealtimeTokenSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "会话编号无效", 400)
  try {
    const conversation = await getChatConversationAccess(
      actor,
      parsed.data.conversationId,
    )
    if (!conversation) return failure("NOT_FOUND", "会话不存在", 404)
    return success({
      token: await signChatRealtimeToken(actor.id, [conversation.id]),
      expiresInSeconds: 300,
    })
  } catch (error) {
    console.error("[API chat realtime-token POST]", error)
    return failure("INTERNAL_ERROR", "创建实时连接凭证失败", 500)
  }
}
