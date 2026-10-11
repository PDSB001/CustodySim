// Deploy as an EdgeOne Edge Function (not EdgeOne Pages middleware).
// Trigger only the image/book/resource paths documented in docs/edgeone-media-cache.md.
// No secret belongs in this file. Signed origin permits are obtained after live authorization.
const CACHE_TTL_SECONDS = 86400
const BOOK_CACHE_TTL_SECONDS = 604800
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const MEDIA_PATHS = [
  ["chat", new RegExp(`^/api/chat/messages/(${UUID})/image$`)],
  ["cover", new RegExp(`^/api/library/(${UUID})/cover$`)],
  ["community", new RegExp(`^/api/community/images/(${UUID})$`)],
  ["book", new RegExp(`^/api/library/(${UUID})/file$`)],
  ["resource", new RegExp(`^/api/library/(${UUID})/resource$`)],
  ["document", new RegExp(`^/api/library/(${UUID})/document$`)],
]

// Keep this in sync with lib/reader-identity.ts. Bump when the shared render contract changes.
const READER_CACHE_SCHEMA = "reader-schema-3-v2"
// Keep old entries (including compressed/framed variants) out of the new delivery path.
const READER_DELIVERY_KEY = "identity-pipe-v1"

async function readerResponse(source, grant, method, event) {
  // The origin allowlists shared fields and attests this exact JSON envelope. Never
  // call json/text/arrayBuffer here: EdgeOne limits those body reads to 1 MB.
  if (
    source.headers.get("X-CustodySim-Reader-Cache-Schema") !==
      READER_CACHE_SCHEMA ||
    source.headers.get("X-CustodySim-Media-Revision") !== grant.revision ||
    (source.headers.get("Content-Type") || "").split(";", 1)[0].trim() !==
      "application/json" ||
    !source.body
  )
    throw new Error("Invalid shared reader snapshot")
  // This is a new representation, not a cached HTTP response. Do not copy its
  // compression, framing, validators, range support or Age into the rewritten JSON.
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-CustodySim-Reader-Cache-Schema": READER_CACHE_SCHEMA,
    "X-CustodySim-Media-Revision": grant.revision,
    "X-CustodySim-Book-Revision": grant.revision,
    "X-Frame-Options": "DENY",
  })
  headers.set("X-CustodySim-Reader-Delivery", "pipe-v1")
  if (method === "HEAD") {
    void source.body.cancel().catch(() => {})
    return privateResponse(null, 200, headers)
  }
  const encoder = new TextEncoder()
  const prefix = encoder.encode('{"success":true,"data":{')
  const reader = source.body.getReader()
  const bytes = (value) =>
    typeof value === "string"
      ? encoder.encode(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value)
  let offset = 0
  let remainder
  try {
    while (offset < prefix.length) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error("Truncated reader envelope")
      const part = bytes(chunk.value)
      const count = Math.min(part.length, prefix.length - offset)
      for (let i = 0; i < count; i++) {
        if (part[i] !== prefix[offset + i])
          throw new Error("Invalid reader envelope")
      }
      offset += count
      remainder = part.subarray(count)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  }
  // Only the fixed envelope was consumed. Hand the rest to the native pipeline
  // rather than manually reading/writing every cached body chunk in JavaScript.
  reader.releaseLock()
  // EdgeOne ignores TransformStream transformer callbacks and does not support
  // constructing ReadableStream. Pump through its supported default stream.
  const { readable, writable } = new TransformStream()
  const pump = (async () => {
    let writer = writable.getWriter()
    let stage = "prefix"
    try {
      await writer.write(
        encoder.encode(
          `{"success":true,"data":{"readerKey":"${grant.readerKey}",`,
        ),
      )
      stage = "remainder"
      // Exact-sized buffers avoid carrying the original chunk's offset/backing
      // buffer into the runtime writer; writes stay below its 32 KB buffer size.
      for (let start = 0; start < remainder.length; start += 16384) {
        await writer.write(remainder.slice(start, start + 16384))
      }
      writer.releaseLock()
      writer = null
      stage = "pipe"
      await source.body.pipeTo(writable)
    } catch (error) {
      const name = ["Error", "TypeError", "RangeError", "AbortError"].includes(
        error?.name,
      )
        ? error.name
        : "UNKNOWN"
      console.warn(
        "[edgeone-media] reader stream failed",
        stage,
        name,
        cacheErrorStatus(error),
      )
      void source.body.cancel().catch(() => {})
      if (writer) await writer.abort().catch(() => {})
      else await writable.abort().catch(() => {})
    } finally {
      writer?.releaseLock()
    }
  })()
  if (typeof event.waitUntil === "function") event.waitUntil(pump)
  return privateResponse(readable, 200, headers)
}

function privateResponse(body, status, headers) {
  const result = new Headers(headers)
  // Every client request must pass the function again, even if the resource bytes are cached.
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

function cacheErrorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.code)
  if (Number.isInteger(status) && status >= 100 && status <= 599)
    return String(status)
  // Return only a numeric status prefix, never the raw message or stack.
  return (
    /^\s*(\d{3})(?:\D|$)/.exec(String(error?.message ?? error ?? ""))?.[1] ||
    "UNKNOWN"
  )
}

async function handleMediaRequest(event) {
  const request = event.request
  const url = new URL(request.url)
  const match = MEDIA_PATHS.map(([kind, pattern]) => [
    kind,
    pattern.exec(url.pathname),
  ]).find(([, result]) => result)
  if (!match) return privateResponse(null, 404)
  if (!["GET", "HEAD"].includes(request.method))
    return privateResponse(null, 405)
  const documentMedia = match[0] === "document"
  const bookMedia =
    match[0] === "book" || match[0] === "resource" || documentMedia
  const resourceTarget =
    match[0] === "resource"
      ? `${url.pathname}?path=${encodeURIComponent(url.searchParams.get("path") || "")}`
      : url.pathname
  try {
    // Metadata and a one-shot recovery request use the original authenticated
    // handler. Recovery never reads a cached permit or a shared response.
    if (
      documentMedia &&
      (url.searchParams.get("metadata") === "1" ||
        url.searchParams.get("delivery") === "origin") &&
      [...url.searchParams].length === 1
    ) {
      const source = await fetch(request, { redirect: "manual" })
      return privateResponse(
        request.method === "HEAD" ? null : source.body,
        source.status,
        source.headers,
      )
    }
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
      !(bookMedia ? /^[0-9a-f]{24}$/ : /^(?:0|legacy|\d{13,16})$/).test(
        grant.revision,
      ) ||
      typeof grant.permit !== "string" ||
      grant.permit.length > 8000 ||
      typeof grant.cacheable !== "boolean" ||
      (bookMedia && grant.target !== resourceTarget) ||
      (documentMedia &&
        (grant.readerSchema !== READER_CACHE_SCHEMA ||
          !/^[0-9a-f]{24}$/.test(grant.readerKey || ""))) ||
      (match[0] === "resource" &&
        !/^[0-9a-f]{64}$/.test(grant.resourceKey || ""))
    )
      return privateResponse(null, 503)

    // A separate, never externally served key. User headers/URL signatures do not split the bytes.
    // The authoritative cover revision comes from the database, not the caller's ?v= parameter.
    // Cache API keys are identifiers, not fetches. Use a neutral URL because EdgeOne rejects
    // Cache API operations under its reserved /__custodysim_media_cache/ path.
    const key = `${url.origin}/__custodysim_cache_probe_data/v1/${grant.kind}/${grant.id}/${grant.revision}${match[0] === "resource" ? `/${grant.resourceKey}` : documentMedia ? `/${READER_CACHE_SCHEMA}/${READER_DELIVERY_KEY}` : ""}`
    // A named namespace is isolated from normal/default URL caching. Only this function ever
    // reads or writes the key; clients cannot retrieve it by requesting the URL directly.
    const cache = await caches.open("custodysim-private-media-v1")
    let cached
    let readState = grant.cacheable ? "MISS" : "SKIPPED"
    if (grant.cacheable) {
      try {
        cached = await cache.match(key)
      } catch {
        /* EdgeOne throws 504 for an expired entry. Treat it as a miss. */
        readState = "ERROR"
      }
    }
    if (cached) {
      const result = documentMedia
        ? await readerResponse(cached, grant, request.method, event)
        : privateResponse(
            request.method === "HEAD" ? null : cached.body,
            200,
            cached.headers,
          )
      result.headers.set("X-CustodySim-Media-Cache", "HIT")
      result.headers.set("X-CustodySim-Media-Cache-Read", "HIT")
      result.headers.set("X-CustodySim-Media-Cache-Write", "NOT-NEEDED")
      return result
    }

    headers.set("x-custodysim-media-permit", grant.permit)
    // Public document snapshots are stored as canonical JSON bytes. Compression
    // for the final client response remains the CDN's responsibility.
    if (documentMedia) headers.set("Accept-Encoding", "identity")
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
    const contentType = (source.headers.get("Content-Type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase()
    let writeState = grant.cacheable ? "SKIP-TYPE" : "SKIP-LEGACY"
    let writeError
    const allowedType = documentMedia
      ? contentType === "application/json"
      : match[0] === "book"
        ? [
            "application/pdf",
            "text/plain",
            "application/epub+zip",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ].includes(contentType)
        : match[0] === "resource"
          ? /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(contentType)
          : /^image\/(png|jpeg|webp)$/.test(contentType)
    // Verify the origin's shared envelope without buffering the document.
    const personalized = documentMedia
      ? await readerResponse(source.clone(), grant, request.method, event)
      : null
    if (grant.cacheable && allowedType) {
      const storageHeaders = new Headers({
        "Content-Type": source.headers.get("Content-Type"),
        "Cache-Control": `public, max-age=${bookMedia ? BOOK_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS}${documentMedia ? ", no-transform" : ""}`,
        "X-Content-Type-Options": "nosniff",
        "X-CustodySim-Media-Revision": grant.revision,
      })
      if (match[0] === "resource")
        storageHeaders.set(
          "Content-Security-Policy",
          "default-src 'none'; sandbox",
        )
      if (documentMedia)
        storageHeaders.set(
          "X-CustodySim-Reader-Cache-Schema",
          READER_CACHE_SCHEMA,
        )
      const length = source.headers.get("Content-Length")
      if (!documentMedia && length && /^\d+$/.test(length))
        storageHeaders.set("Content-Length", length)
      // Only this internal copy is cacheable. No Cookie, CSP nonce, credential or permit is stored.
      const storage = new Response(
        documentMedia ? source.body : source.clone().body,
        {
          headers: storageHeaders,
        },
      )
      // put() can resolve even when nothing was stored. Confirm the entry instead of
      // silently discarding write failures. This adds work only on cache misses.
      const store = async () => {
        try {
          await cache.put(key, storage)
          const stored = await cache.match(key)
          const state = stored?.status === 200 ? "STORED" : "NOT-STORED"
          // A cloned stream's cancellation may wait for another reader; never block delivery.
          void stored?.body?.cancel().catch(() => {})
          if (state !== "STORED")
            console.warn("[edgeone-media] cache write not retained")
          return { state }
        } catch (error) {
          const status = cacheErrorStatus(error)
          console.warn(
            "[edgeone-media] cache write/verification failed",
            status,
          )
          return { state: "ERROR", error: status }
        }
      }
      if (
        (match[0] === "book" || documentMedia) &&
        typeof event.waitUntil === "function"
      ) {
        // Stream large books immediately; waitUntil keeps the cache write alive after delivery.
        event.waitUntil(store())
        writeState = "PENDING"
      } else {
        const stored = await store()
        writeState = stored.state
        writeError = stored.error
      }
    } else if (documentMedia) {
      void source.body.cancel().catch(() => {})
    }
    const result =
      personalized ||
      privateResponse(
        request.method === "HEAD" ? null : source.body,
        200,
        source.headers,
      )
    if (match[0] === "resource")
      result.headers.set(
        "Content-Security-Policy",
        "default-src 'none'; sandbox",
      )
    result.headers.set("X-CustodySim-Media-Cache", "MISS")
    result.headers.set("X-CustodySim-Media-Cache-Read", readState)
    result.headers.set("X-CustodySim-Media-Cache-Write", writeState)
    if (writeError)
      result.headers.set("X-CustodySim-Media-Cache-Error", writeError)
    return result
  } catch {
    // Auth/server/network failures must never fall back to a previously authorized image.
    return privateResponse(null, 503)
  }
}

addEventListener("fetch", (event) =>
  event.respondWith(handleMediaRequest(event)),
)
