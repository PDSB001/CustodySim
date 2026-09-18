import type { NextRequest } from "next/server"

import { isNativeClient } from "@/lib/native-client"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * 可信来源名单。
 *
 * 从 `APP_ORIGIN` 读取（逗号分隔多个）。生产环境读不到就返回**空名单** ——
 * 也就是"没配 APP_ORIGIN ⇒ 所有写请求都拒绝"，宁可全拒也不静默放行。
 */
export function getTrustedOrigins(request: NextRequest) {
  const configured = process.env.APP_ORIGIN
  if (configured) {
    const origins = configured.split(",").flatMap((value) => {
      try {
        return [new URL(value.trim()).origin]
      } catch {
        return []
      }
    })
    // Keep local development usable even when .env.local still contains a
    // production APP_ORIGIN copied from a deployment environment.
    if (process.env.NODE_ENV !== "production")
      origins.push(request.nextUrl.origin)
    return [...new Set(origins)]
  }
  return process.env.NODE_ENV === "production" ? [] : [request.nextUrl.origin]
}

/**
 * 判断一个写请求是否来自可信来源（CSRF 防线）。
 *
 * 放行条件（满足其一）：
 * - 非 `/api/**`，或不是写方法
 * - 非生产环境（本地开发允许混用 localhost / 127.0.0.1 / 局域网地址）
 * - 带了约定的原生客户端头：原生 HTTP 客户端不发 Origin，靠这个头证明自己不是
 *   跨源页面。浏览器跨源请求在通过 CORS 预检前无法携带自定义头，因此伪造不出来
 * - `Origin` 命中 `APP_ORIGIN` 名单
 */
export function isSameOriginMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return true
  if (!MUTATING_METHODS.has(request.method)) return true
  // Local development may legitimately mix localhost, 127.0.0.1, and a LAN
  // address while testing. Keep origin enforcement strict in production only.
  if (process.env.NODE_ENV !== "production") return true
  // 原生客户端不带 Origin，靠自定义头证明自己不是跨源页面（详见 lib/native-client.ts）。
  if (isNativeClient(request.headers)) return true
  const origin = request.headers.get("origin")
  return Boolean(origin && getTrustedOrigins(request).includes(origin))
}
