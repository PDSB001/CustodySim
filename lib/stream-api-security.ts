/** JSON streaming endpoints excluded from Proxy must still wrap every response. */
export function secureStreamApiResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store")
  // This is a JSON API, so it needs no script nonce or executable document content.
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  )
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  )
  if (process.env.NODE_ENV === "production")
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    )
  return response
}
