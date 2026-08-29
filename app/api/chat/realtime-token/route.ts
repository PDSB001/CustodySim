import { failure, success } from "@/lib/api-response"
import { signChatRealtimeToken } from "@/lib/auth"
import { listAccessibleConversationIds } from "@/lib/chat-server"
import { getSessionUser } from "@/lib/session"

export async function POST() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const conversationIds = await listAccessibleConversationIds(actor)
    return success({
      token: await signChatRealtimeToken(actor.id, conversationIds),
      expiresInSeconds: 300,
    })
  } catch (error) {
    console.error("[API chat realtime-token POST]", error)
    return failure("INTERNAL_ERROR", "创建实时连接凭证失败", 500)
  }
}
