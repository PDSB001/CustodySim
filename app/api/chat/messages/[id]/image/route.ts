import { and, eq, gte } from "drizzle-orm"
import { z } from "zod"

import { CHAT_MESSAGE_TYPE_IMAGE, retentionCutoff } from "@/lib/chat"
import { getChatConversationAccess } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { chatMessages } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { parseTaskImageDataUrl } from "@/lib/task-image"

const IdSchema = z.string().uuid()

/**
 * 取不到图片时的统一响应。
 *
 * "不存在 / 已撤回 / 无权查看 / 超出留存期"一律给同一个 404：不区分原因，
 * 避免把"这条消息存在但你无权看"暴露给越权调用方。禁止缓存失败结果。
 */
function notFound() {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  })
}

/**
 * 聊天图片的独立端点。
 *
 * 为什么不把 data URL 放在消息体里下发：单张约 1.4 MB，轮询与"重开会话"会反复搬运
 * 同一张图；独立端点按消息 ID 不可变，可以让浏览器长期强缓存，只下载一次。
 *
 * 鉴权与留存口径与消息列表完全一致：同一 `retentionCutoff`、同一会话可见性判定。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor)
    return new Response(null, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    })
  const id = IdSchema.safeParse((await context.params).id)
  if (!id.success) return notFound()
  try {
    const [message] = await db
      .select({
        conversationId: chatMessages.conversationId,
        type: chatMessages.type,
        content: chatMessages.content,
        recalledAt: chatMessages.recalledAt,
      })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, id.data),
          // 与消息列表同一口径：超出本人留存期的消息，连图片也不再下发。
          gte(chatMessages.createdAt, retentionCutoff(actor.role)),
        ),
      )
      .limit(1)
    if (!message || message.type !== CHAT_MESSAGE_TYPE_IMAGE) return notFound()
    if (message.recalledAt) return notFound()
    if (!(await getChatConversationAccess(actor, message.conversationId)))
      return notFound()
    const image = message.content
      ? parseTaskImageDataUrl(message.content)
      : null
    if (!image) return notFound()
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        // 内容按消息 ID 不可变，可以长期强缓存；`private` 是因为可见性随登录身份而定，
        // 不允许中间/共享缓存留存；`Vary` 让浏览器缓存按凭据分桶，避免同机换号后串图。
        "Cache-Control": "private, max-age=31536000, immutable",
        Vary: "Cookie, Authorization",
        // 图片是从 base64 还原的字节，声明真实 MIME 后禁止浏览器再嗅探类型。
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("[API chat message image GET]", error)
    return new Response(null, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    })
  }
}
