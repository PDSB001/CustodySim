import { NextRequest, NextResponse } from "next/server"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

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

function getTrustedOrigins(request: NextRequest) {
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

function isSameOriginMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return true
  if (!MUTATING_METHODS.has(request.method)) return true
  // Local development may legitimately mix localhost, 127.0.0.1, and a LAN
  // address while testing. Keep origin enforcement strict in production only.
  if (process.env.NODE_ENV !== "production") return true
  const origin = request.headers.get("origin")
  return Boolean(origin && getTrustedOrigins(request).includes(origin))
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
  request: NextRequest,
) {
  const usesTencentMap =
    request.nextUrl.pathname.startsWith("/electronic-fences") ||
    request.nextUrl.pathname.startsWith("/my/electronic-fence")
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
  if (request.nextUrl.pathname.startsWith("/api/"))
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
    request.nextUrl.pathname.startsWith("/electronic-fences") ||
      request.nextUrl.pathname.startsWith("/my/electronic-fence"),
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
