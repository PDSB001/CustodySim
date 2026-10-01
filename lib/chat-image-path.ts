/**
 * 聊天图片端点的路径形状：`/api/chat/messages/{消息 UUID}/image`。
 *
 * `proxy.ts` 默认给所有 `/api/**` 响应加 `private, no-store`，而图片端点必须让路由
 * 自己声明强缓存（内容按消息 ID 不可变、只下载一次），所以要在那里按路径放行。
 * 生成地址与放行判定共用这一份规则：两处各写一遍早晚会漂移，表现为"缓存突然失效"
 * 而没有任何报错。
 */
const CHAT_IMAGE_PATH_PREFIX = "/api/chat/messages/"
const CHAT_IMAGE_PATH_SUFFIX = "/image"

export function chatImagePath(messageId: string) {
  return `${CHAT_IMAGE_PATH_PREFIX}${messageId}${CHAT_IMAGE_PATH_SUFFIX}`
}

export function isChatImagePath(pathname: string) {
  return (
    pathname.startsWith(CHAT_IMAGE_PATH_PREFIX) &&
    pathname.endsWith(CHAT_IMAGE_PATH_SUFFIX)
  )
}
