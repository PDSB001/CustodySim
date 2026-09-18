import { createHmac, randomBytes } from "node:crypto"

import { assertUsableSecret } from "@/lib/secret-guard"

/**
 * 刷新令牌有效期。专用终端不应频繁要求重新登录，因此与"受信任设备"保持同一量级；
 * 真正的失效控制靠 users.tokenVersion（登出/改密/停用即时吊销），不靠缩短这个时间。
 */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

export function generateRefreshToken() {
  return randomBytes(32).toString("base64url")
}

/** 令牌本体不落库，只存这份 HMAC；密钥与 AUTH_SECRET 一致，轮换 AUTH_SECRET 即全部失效。 */
export function hashRefreshToken(token: string) {
  const secret = assertUsableSecret("AUTH_SECRET", process.env.AUTH_SECRET)
  return createHmac("sha256", secret)
    .update(`custodysim:refresh-token:v1:${token}`)
    .digest("hex")
}
