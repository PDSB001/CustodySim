import { NextRequest, NextResponse } from "next/server"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function createNonce() {
  return crypto.randomUUID().replaceAll("-", "")
}

function getContentSecurityPolicy(nonce: string, usesTencentMap: boolean) {
  return [
    "default-src 'self'",
    // Tencent Maps GL currently requires eval internally for its WebGL runtime.
    `script-src 'self' 'nonce-${nonce}'${usesTencentMap ? " 'unsafe-eval'" : ""} https://map.qq.com https://*.map.qq.com`,
    usesTencentMap ? "worker-src 'self' blob:" : "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.qq.com https://*.gtimg.com https://*.qpic.cn",
    "font-src 'self' data:",
    "connect-src 'self' https://*.qq.com https://*.gtimg.com https://*.qpic.cn",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

function getTrustedOrigins(request: NextRequest) {
  const configured = process.env.APP_ORIGIN
  if (configured) {
    return configured.split(",").flatMap((value) => {
      try {
        return [new URL(value.trim()).origin]
      } catch {
        return []
      }
    })
  }
  return process.env.NODE_ENV === "production" ? [] : [request.nextUrl.origin]
}

function isSameOriginMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return true
  if (!MUTATING_METHODS.has(request.method)) return true
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
  response.headers.set("Content-Security-Policy", getContentSecurityPolicy(nonce, usesTencentMap))
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
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
        { success: false, error: { code: "FORBIDDEN", message: "请求来源不受信任" } },
        { status: 403 },
      ),
      nonce,
      request,
    )

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  return applySecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
    request,
  )
}

export const config = { matcher: ["/:path*"] }
