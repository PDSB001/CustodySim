// Deploy as an EdgeOne Edge Function (not EdgeOne Pages middleware).
// Trigger the image paths AND the reserved internal-key prefix documented in docs/edgeone-media-cache.md.
// No secret belongs in this file. Signed origin permits are obtained after live authorization.
const CACHE_TTL_SECONDS = 86400
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const IMAGE_PATHS = [
  ["chat", new RegExp(`^/api/chat/messages/(${UUID})/image$`)],
  ["cover", new RegExp(`^/api/library/(${UUID})/cover$`)],
  ["community", new RegExp(`^/api/community/images/(${UUID})$`)],
]

function privateResponse(body, status, headers) {
  const result = new Headers(headers)
  // Every client request must pass the function again, even if the picture bytes are cached.
  result.set("Cache-Control", "private, no-store")
  result.set("Vary", "Cookie, Authorization")
  result.set("X-Content-Type-Options", "nosniff")
  result.delete("Set-Cookie")
  return new Response(body, { status, headers: result })
}

function credentials(request) {
  const headers = new Headers()
  for (const name of ["authorization", "cookie", "x-custodysim-client"]) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name))
  }
  return headers
}

async function handleMediaRequest(event) {
  const request = event.request
  const url = new URL(request.url)
  const match = IMAGE_PATHS.map(([kind, pattern]) => [
    kind,
    pattern.exec(url.pathname),
  ]).find(([, result]) => result)
  if (!match) return privateResponse(null, 404)
  if (!["GET", "HEAD"].includes(request.method))
    return privateResponse(null, 405)
  try {
    const headers = credentials(request)
    const authorizeUrl = new URL("/api/media/authorize", url.origin)
    authorizeUrl.searchParams.set("target", url.pathname + url.search)
    const authorization = await fetch(authorizeUrl.toString(), {
      headers,
      redirect: "manual",
    })
    if (authorization.status === 204) {
      // Same-host fetch follows EdgeOne's origin/cache pipeline without executing this function again.
      // The unchanged original handler performs normal login and resource authorization.
      const source = await fetch(request, { redirect: "manual" })
      return privateResponse(
        request.method === "HEAD" ? null : source.body,
        source.status,
        source.headers,
      )
    }
    if (authorization.status !== 200) {
      return privateResponse(
        null,
        [401, 403, 404].includes(authorization.status)
          ? authorization.status
          : 503,
      )
    }
    const grant = await authorization.json()
    if (
      grant.kind !== match[0] ||
      grant.id !== match[1][1] ||
      typeof grant.revision !== "string" ||
      !/^(?:0|legacy|\d{13,16})$/.test(grant.revision) ||
      typeof grant.permit !== "string" ||
      grant.permit.length > 1000 ||
      typeof grant.cacheable !== "boolean"
    )
      return privateResponse(null, 503)

    // A separate, never externally served key. User headers/URL signatures do not split the bytes.
    // The authoritative cover revision comes from the database, not the caller's ?v= parameter.
    const key = new Request(
      `${url.origin}/__custodysim_media_cache/v1/${grant.kind}/${grant.id}/${grant.revision}`,
    )
    // A named namespace is isolated from normal/default URL caching. The reserved URL prefix
    // must also trigger this function: direct requests to it fail the image allowlist above.
    const cache = await caches.open("custodysim-private-media-v1")
    let cached
    if (grant.cacheable) {
      try {
        cached = await cache.match(key)
      } catch {
        /* EdgeOne throws 504 for an expired entry. Treat it as a miss. */
      }
    }
    if (cached) {
      const result = privateResponse(
        request.method === "HEAD" ? null : cached.body,
        200,
        cached.headers,
      )
      result.headers.set("X-CustodySim-Media-Cache", "HIT")
      return result
    }

    headers.set("x-custodysim-media-permit", grant.permit)
    const source = await fetch(
      new URL("/api/media/content", url.origin).toString(),
      {
        headers,
        redirect: "manual",
      },
    )
    if (
      source.status !== 200 ||
      source.headers.get("X-CustodySim-Media-Revision") !== grant.revision
    )
      return privateResponse(
        null,
        [401, 403, 404].includes(source.status) ? source.status : 503,
      )
    if (
      grant.cacheable &&
      /^image\/(png|jpeg|webp)$/.test(source.headers.get("Content-Type") || "")
    ) {
      const storageHeaders = new Headers({
        "Content-Type": source.headers.get("Content-Type"),
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        "X-Content-Type-Options": "nosniff",
      })
      // Only this internal copy is cacheable. No Cookie, CSP nonce, credential or permit is stored.
      const storage = new Response(source.clone().body, {
        headers: storageHeaders,
      })
      event.waitUntil(cache.put(key, storage).catch(() => {}))
    }
    const result = privateResponse(
      request.method === "HEAD" ? null : source.body,
      200,
      source.headers,
    )
    result.headers.set("X-CustodySim-Media-Cache", "MISS")
    return result
  } catch {
    // Auth/server/network failures must never fall back to a previously authorized image.
    return privateResponse(null, 503)
  }
}

addEventListener("fetch", (event) =>
  event.respondWith(handleMediaRequest(event)),
)
