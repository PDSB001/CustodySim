// Temporary standalone EdgeOne function. Trigger ONLY /__custodysim_cache_probe on the business host.
// This never fetches the origin, reads application pictures, or forwards Cookie/Authorization.
// Remove its trigger after collecting results. Cache entries contain only fixed public test text.
function describeError(error) {
  return {
    name: String(error?.name || typeof error),
    message: String(error?.message || error).slice(0, 500),
    status: String(error?.status ?? error?.statusCode ?? error?.code ?? ""),
  }
}

async function probe(request) {
  const url = new URL(request.url)
  if (url.pathname !== "/__custodysim_cache_probe" || request.method !== "GET")
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    })
  const results = []
  const attempts = [
    ["named-request-internal", "custodysim-private-media-v1", true, true],
    ["named-string-internal", "custodysim-private-media-v1", false, true],
    ["named-string-neutral", "custodysim-private-media-v1", false, false],
    ["default-string-neutral", "default", false, false],
  ]
  for (const [name, namespace, requestObject, internal] of attempts) {
    const result = { name, stage: "open" }
    try {
      const cache = await caches.open(namespace)
      result.methods = { match: typeof cache?.match, put: typeof cache?.put }
      const prefix = internal
        ? "/__custodysim_media_cache"
        : "/__custodysim_cache_probe_data"
      const keyUrl = `${url.origin}${prefix}/probe-v1/${name}`
      const key = requestObject ? new Request(keyUrl) : keyUrl
      const storage = new Response("custodysim-public-cache-probe-v1", {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "public, s-maxage=60, max-age=60",
        },
      })
      result.stage = "put"
      await cache.put(key, storage)
      result.putReturned = true
      result.stage = "match"
      const hit = await cache.match(key)
      result.hit = !!hit
      result.status = hit?.status ?? null
      // Do not read cached bytes: only report whether the public test key was found.
      if (hit?.body) void hit.body.cancel().catch(() => {})
      result.stage = "done"
    } catch (error) {
      result.error = describeError(error)
    }
    results.push(result)
  }
  return new Response(JSON.stringify({ probeVersion: 1, results }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

addEventListener("fetch", (event) => event.respondWith(probe(event.request)))
