import { NextRequest, NextResponse } from "next/server"

import { isChatImagePath } from "@/lib/chat-image-path"
import { isTencentMapPath } from "@/lib/map-paths"
import { isSameOriginMutation } from "@/lib/request-origin"

function createNonce() {
  return crypto.randomUUID().replaceAll("-", "")
}

function getRealtimeConnectSources(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_CHAT_REALTIME_URL
  if (!configured && process.env.NODE_ENV === "production") return ""
  try {
    const url = configured
      ? new URL(configured)
      : new URL(
          `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`,
        )
    if (!configured) url.port = "3001"
    const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:"
    return ` ${url.origin} ${websocketProtocol}//${url.host}`
  } catch {
    return ""
  }
}

function getContentSecurityPolicy(
  nonce: string,
  usesTencentMap: boolean,
  request: NextRequest,
) {
  const allowsUnsafeEval =
    process.env.NODE_ENV !== "production" || usesTencentMap
  return [
    "default-src 'self'",
    // Tencent Maps GL currently requires eval internally for its WebGL runtime.
    `script-src 'self' 'nonce-${nonce}'${allowsUnsafeEval ? " 'unsafe-eval'" : ""} https://map.qq.com https://*.map.qq.com`,
    usesTencentMap ? "worker-src 'self' blob:" : "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.qq.com https://*.gtimg.com https://*.qpic.cn",
    "font-src 'self' data:",
    `connect-src 'self'${getRealtimeConnectSources(request)} https://*.qq.com https://*.gtimg.com https://*.qpic.cn`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
  request: NextRequest,
) {
  const usesTencentMap = isTencentMapPath(request.nextUrl.pathname)
  response.headers.set(
    "Content-Security-Policy",
    getContentSecurityPolicy(nonce, usesTencentMap, request),
  )
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  )
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  if (process.env.NODE_ENV === "production")
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    )
  // API 响应默认禁止缓存。唯一的例外是聊天图片端点：它由路由自己声明强缓存
  // （内容按消息 ID 不可变），不豁免的话每次渲染都要重新下载整张图（单张约 1.4 MB）。
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    !isChatImagePath(request.nextUrl.pathname)
  )
    response.headers.set("Cache-Control", "private, no-store")
  return response
}

export function proxy(request: NextRequest) {
  const nonce = createNonce()
  if (!isSameOriginMutation(request))
    return applySecurityHeaders(
      NextResponse.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "请求来源不受信任" },
        },
        { status: 403 },
      ),
      nonce,
      request,
    )

  const requestHeaders = new Headers(request.headers)
  const contentSecurityPolicy = getContentSecurityPolicy(
    nonce,
    isTencentMapPath(request.nextUrl.pathname),
    request,
  )
  requestHeaders.set("x-nonce", nonce)
  // Next.js reads the request CSP while rendering and applies this nonce to
  // its generated script tags. Setting it only on the response is too late.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy)
  return applySecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
    request,
  )
}

export const config = { matcher: ["/:path*"] }
