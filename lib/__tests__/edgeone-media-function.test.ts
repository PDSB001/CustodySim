import { readFileSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import { runInNewContext } from "node:vm"
import { expect, test, vi } from "vitest"

const source = readFileSync(
  new URL("../../deploy/edgeone/media-cache.js", import.meta.url),
  "utf8",
)

function runtime(kind: "chat" | "book" | "resource" | "document" = "chat") {
  const id = randomUUID()
  const pathname =
    kind === "chat"
      ? `/api/chat/messages/${id}/image`
      : `/api/library/${id}/${kind === "book" ? "file" : kind}`
  const path = pathname + (kind === "resource" ? "?path=OPS%2Fa.png" : "")
  const entries = new Map<string, Response>()
  const cachedKeys: string[] = []
  const background: Promise<unknown>[] = []
  let authStatus = 200
  let version = kind === "chat" ? "0" : "0123456789abcdef01234567"
  let cacheable = true
  let originalStatus = 200
  let contentRevision: string | null = null
  let contentType =
    kind === "book"
      ? "application/pdf"
      : kind === "document"
        ? "application/json"
        : "image/png"
  let currentReaderKey = "111111111111111111111111"
  let personalSource = false
  let documentHtml = "<p>共享正文</p>"
  let splitDocument = false
  let chunkSize = 65537
  let legacyClient = false
  const fetch = vi.fn(async (input: Request | string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    if (url.pathname === "/api/media/authorize") {
      const target = url.searchParams.get("target")!
      expect(new URL(target, "https://site.test").pathname).toBe(pathname)
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer user-token",
      )
      return authStatus === 200
        ? Response.json({
            kind,
            id,
            revision: version,
            permit: "signed-origin-permit",
            cacheable,
            target,
            ...(kind === "document"
              ? {
                  readerKey: currentReaderKey,
                  readerSchema: "reader-schema-3-v2",
                }
              : {}),
            ...(kind === "resource"
              ? {
                  resourceKey: createHash("sha256")
                    .update(target)
                    .digest("hex"),
                }
              : {}),
          })
        : new Response(null, { status: authStatus })
    }
    if (url.pathname === "/api/media/content") {
      if (kind === "document")
        expect(new Headers(init?.headers).get("Accept-Encoding")).toBe(
          "identity",
        )
      expect(new Headers(init?.headers).get("x-custodysim-media-permit")).toBe(
        "signed-origin-permit",
      )
      const body =
        kind === "document"
          ? JSON.stringify({
              success: true,
              data: {
                version: 1,
                revision: version,
                pages: 1,
                chapters: [{ html: documentHtml }],
                ...(personalSource ? { readerKey: currentReaderKey } : {}),
              },
            })
          : "picture-bytes"
      const encoded = new TextEncoder().encode(body)
      let position = 0
      const response = new Response(
        splitDocument
          ? new ReadableStream({
              pull(controller) {
                if (position === encoded.length) return controller.close()
                // Split the envelope and UTF-8 characters across chunks.
                const end = Math.min(
                  encoded.length,
                  position + (position < 30 ? 1 : chunkSize),
                )
                controller.enqueue(encoded.subarray(position, end))
                position = end
              },
            })
          : body,
        {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "private, no-store",
            "Set-Cookie": "must-not-be-stored",
            "X-CustodySim-Media-Revision": contentRevision ?? version,
            ...(kind === "document" && !personalSource
              ? {
                  "X-CustodySim-Reader-Cache-Schema": "reader-schema-3-v2",
                }
              : {}),
          },
        },
      )
      // Model EdgeOne's unsupported oversized body read, including cloned responses.
      const guard = (value: Response): Response => {
        const clone = value.clone.bind(value)
        value.clone = () => guard(clone())
        if (encoded.length > 1024 * 1024) {
          value.json = async () => {
            throw new Error("OverSize")
          }
          value.text = async () => {
            throw new Error("OverSize")
          }
          value.arrayBuffer = async () => {
            throw new Error("OverSize")
          }
        }
        return value
      }
      return guard(response)
    }
    if (url.pathname === pathname)
      return new Response("original", { status: originalStatus })
    throw new Error("Unexpected fetch target")
  })
  const cache = {
    match: vi.fn(async (key: Request | string) =>
      entries.get(typeof key === "string" ? key : key.url)?.clone(),
    ),
    put: vi.fn(async (key: Request | string, response: Response) => {
      expect(typeof key).toBe("string")
      expect(response.headers.get("Cache-Control")).toBe(
        `public, max-age=${kind === "chat" ? 86400 : 604800}${kind === "document" ? ", no-transform" : ""}`,
      )
      expect(response.headers.has("set-cookie")).toBe(false)
      expect(response.headers.has("vary")).toBe(false)
      cachedKeys.push(key as string)
      entries.set(key as string, response.clone())
    }),
  }
  let listener: (event: unknown) => void = () => {
    throw new Error("Missing listener")
  }
  const warn = vi.fn()
  runInNewContext(source, {
    Request,
    Response,
    Headers,
    URL,
    TransformStream,
    TextEncoder,
    fetch,
    console: { warn },
    caches: {
      open: async (name: string) => {
        expect(name).toBe("custodysim-private-media-v1")
        return cache
      },
    },
    addEventListener: (_: string, callback: typeof listener) => {
      listener = callback
    },
  })
  return {
    fetch,
    cache,
    warn,
    cachedKeys,
    path,
    settle: () => Promise.all(background),
    authorize: (status: number) => {
      authStatus = status
    },
    revise: (next: string) => {
      version = next
    },
    mismatch: () => {
      contentRevision = "legacy"
    },
    noCache: () => {
      cacheable = false
    },
    contentType: (next: string) => {
      contentType = next
    },
    original: (status: number) => {
      originalStatus = status
    },
    readerKey: (next: string) => {
      currentReaderKey = next
    },
    personalSource: () => {
      personalSource = true
    },
    largeDocument: (html: string, size = 65537) => {
      documentHtml = html
      splitDocument = true
      chunkSize = size
    },
    legacyClient: () => {
      legacyClient = true
    },
    async request(method = "GET", target = path, waitForCache = true) {
      const pending: Promise<unknown>[] = []
      let response: Promise<Response> | undefined
      listener({
        request: new Request(`https://site.test${target}`, {
          method,
          headers: {
            authorization: "Bearer user-token",
            "cache-control": "no-cache",
            pragma: "no-cache",
            "x-custodysim-media-permit": "attacker-value",
            ...(kind === "document" && !legacyClient
              ? {
                  "X-CustodySim-Reader-Delivery": "shared-v1",
                }
              : {}),
          },
        }),
        waitUntil: (job: Promise<unknown>) => {
          pending.push(job)
          background.push(job)
        },
        respondWith: (job: Promise<Response>) => {
          response = job
        },
      })
      const result = await response!
      // Stream pumps require the caller to consume the response first.
      if (waitForCache && kind !== "document") await Promise.all(pending)
      return result
    },
  }
}

test("document hits reuse untouched shared content and send current identity only in headers", async () => {
  const app = runtime("document")
  const first = await app.request()
  expect(first.headers.get("X-CustodySim-Media-Cache")).toBe("MISS")
  expect((await first.json()).data.readerKey).toBeUndefined()
  expect(first.headers.get("X-CustodySim-Reader-Key")).toBe(
    "111111111111111111111111",
  )
  await app.settle()
  const stored = await app.cache.match(app.cachedKeys[0])
  expect(JSON.stringify(await stored!.json())).not.toContain("readerKey")
  app.readerKey("222222222222222222222222")
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
  const payload = await hit.json()
  expect(payload.data.readerKey).toBeUndefined()
  expect(hit.headers.get("X-CustodySim-Reader-Key")).toBe(
    "222222222222222222222222",
  )
  expect(payload.data.chapters[0].html).toBe("<p>共享正文</p>")
  expect(app.cache.put).toHaveBeenCalledTimes(1)
  expect(
    app.fetch.mock.calls.filter(([url]) => String(url).includes("/content")),
  ).toHaveLength(1)
  expect(app.cachedKeys[0]).not.toContain("111111")
  expect(app.cachedKeys[0]).toContain("/reader-schema-3-v2/opaque-v1")
  expect(stored!.headers.has("X-CustodySim-Reader-Key")).toBe(false)
  expect(await (await app.request("HEAD")).text()).toBe("")
  app.revise("abcdef0123456789abcdef01")
  const revised = await app.request()
  expect(revised.headers.get("X-CustodySim-Media-Cache")).toBe("MISS")
  await revised.json()
  await app.settle()
  app.authorize(404)
  expect((await app.request()).status).toBe(404)
})

test("EPUB JSON larger than 1 MB streams with intact UTF-8 and isolated identities on misses and hits", async () => {
  const app = runtime("document")
  const html = "<p>中文📚内容</p>".repeat(60000)
  expect(new TextEncoder().encode(html).length).toBeGreaterThan(1024 * 1024)
  app.largeDocument(html)
  const miss = await app.request()
  expect(miss.status).toBe(200)
  expect((await miss.json()).data.chapters[0].html).toBe(html)
  await app.settle()
  const stored = await app.cache.match(app.cachedKeys[0])
  expect((await stored!.json()).data.readerKey).toBeUndefined()
  app.readerKey("222222222222222222222222")
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
  const payload = await hit.json()
  expect(payload.data.chapters[0].html).toBe(html)
  expect(payload.data.readerKey).toBeUndefined()
  expect(hit.headers.get("X-CustodySim-Reader-Key")).toBe(
    "222222222222222222222222",
  )
  await app.settle()
  app.authorize(403)
  expect((await app.request()).status).toBe(403)
})

test.each([7, 23, 2887, 16384, 65537])(
  "JSON bytes remain identical across miss, stored copy and hit with %i-byte chunks",
  async (size) => {
    const app = runtime("document")
    app.largeDocument(
      '<p>中文📚 "引号", \\反斜杠 &amp; 换行\n</p>'.repeat(400),
      size,
    )
    const first = await app.request()
    const bytes = Buffer.from(await first.arrayBuffer())
    expect(JSON.parse(bytes.toString()).data.readerKey).toBeUndefined()
    await app.settle()
    const stored = await app.cache.match(app.cachedKeys[0])
    expect(Buffer.from(await stored!.arrayBuffer())).toEqual(bytes)
    app.readerKey("222222222222222222222222")
    const hit = await app.request()
    expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
    expect(Buffer.from(await hit.arrayBuffer())).toEqual(bytes)
    expect(hit.headers.get("X-CustodySim-Reader-Key")).toBe(
      "222222222222222222222222",
    )
    await app.settle()
  },
)

test("metadata bypasses document caching and personalized origin bodies are rejected", async () => {
  const app = runtime("document")
  expect(
    await (await app.request("GET", `${app.path}?metadata=1`)).text(),
  ).toBe("original")
  expect(app.fetch).toHaveBeenCalledTimes(1)
  expect(app.cache.match).not.toHaveBeenCalled()
  app.personalSource()
  expect((await app.request()).status).toBe(503)
  expect(app.cache.put).not.toHaveBeenCalled()
})

test("legacy clients keep the personalized origin protocol with live access checks", async () => {
  const app = runtime("document")
  app.legacyClient()
  expect(await (await app.request()).text()).toBe("original")
  app.original(403)
  expect((await app.request()).status).toBe(403)
  expect(app.cache.match).not.toHaveBeenCalled()
  expect(app.cache.put).not.toHaveBeenCalled()
})

test("recovery bypasses shared storage and preserves original access denial", async () => {
  const app = runtime("document")
  app.original(403)
  const result = await app.request("GET", `${app.path}?delivery=origin`)
  expect(result.status).toBe(403)
  expect(result.headers.get("Cache-Control")).toBe("private, no-store")
  expect(app.fetch).toHaveBeenCalledTimes(1)
  expect(app.cache.match).not.toHaveBeenCalled()
  expect(app.cache.put).not.toHaveBeenCalled()
})

test("cached encoded bytes and their encoding are forwarded without rewriting", async () => {
  const app = runtime("document")
  await (await app.request()).json()
  await app.settle()
  const encoded = gzipSync(
    '{"success":true,"data":{"revision":"0123456789abcdef01234567","text":"中文📚"}}',
  )
  app.cache.match.mockResolvedValueOnce(
    new Response(encoded, {
      headers: {
        "Content-Type": "application/json",
        "X-CustodySim-Media-Revision": "0123456789abcdef01234567",
        "X-CustodySim-Reader-Cache-Schema": "reader-schema-3-v2",
        "Content-Length": String(encoded.length),
        "Content-Encoding": "gzip",
        Age: "818",
        "Accept-Ranges": "bytes",
      },
    }),
  )
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Reader-Delivery")).toBe("shared-v1")
  expect(hit.headers.get("Content-Length")).toBe(String(encoded.length))
  expect(hit.headers.get("Content-Encoding")).toBe("gzip")
  expect(Buffer.from(await hit.arrayBuffer())).toEqual(encoded)
  await app.settle()
  expect(app.warn).not.toHaveBeenCalled()
})

test("document HEAD misses retain only the shared copy and return no body", async () => {
  const app = runtime("document")
  const response = await app.request("HEAD")
  expect(response.status).toBe(200)
  expect(await response.text()).toBe("")
  await app.settle()
  const stored = await app.cache.match(app.cachedKeys[0])
  expect((await stored!.json()).data.readerKey).toBeUndefined()
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
  expect((await hit.json()).data.readerKey).toBeUndefined()
  expect(hit.headers.get("X-CustodySim-Reader-Key")).toBe(
    "111111111111111111111111",
  )
  await app.settle()
})

test("second image request checks live authorization but does not fetch picture bytes again", async () => {
  const app = runtime()
  expect(await (await app.request()).text()).toBe("picture-bytes")
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
  expect(hit.headers.get("Cache-Control")).toBe("private, no-store")
  expect(await hit.text()).toBe("picture-bytes")
  expect(
    app.fetch.mock.calls.filter(([url]) => String(url).includes("/authorize"))
      .length,
  ).toBe(2)
  expect(
    app.fetch.mock.calls.filter(([url]) => String(url).includes("/content"))
      .length,
  ).toBe(1)
  expect(app.cachedKeys[0]).not.toMatch(/user-token|permit|authorization/)
  expect(app.cachedKeys[0]).toContain("/__custodysim_cache_probe_data/v1/chat/")
  expect(app.cachedKeys[0]).not.toContain("/__custodysim_media_cache/")
  expect(
    (await app.request("GET", new URL(app.cachedKeys[0]).pathname)).status,
  ).toBe(404)
  expect(app.cache.match).toHaveBeenCalledTimes(3)
})

test("book downloads stream before cache writes finish and check auth on every hit", async () => {
  const app = runtime("book")
  const put = app.cache.put.getMockImplementation()!
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  app.cache.put.mockImplementationOnce(async (key, response) => {
    await gate
    return put(key, response)
  })
  const miss = await app.request("GET", app.path, false)
  expect(miss.headers.get("X-CustodySim-Media-Cache-Write")).toBe("PENDING")
  expect(await miss.text()).toBe("picture-bytes")
  release()
  await app.settle()
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
  expect(hit.headers.get("Cache-Control")).toBe("private, no-store")
  app.authorize(404)
  expect((await app.request()).status).toBe(404)
  expect(app.cache.put).toHaveBeenCalledTimes(1)
})

test("EPUB resources use separate keys per archive path and keep SVG sandboxing on hits", async () => {
  const app = runtime("resource")
  app.contentType("image/svg+xml")
  for (const target of [app.path, app.path.replace("a.png", "b.png")]) {
    const miss = await app.request("GET", target)
    expect(miss.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox",
    )
    const hit = await app.request("GET", target)
    expect(hit.headers.get("X-CustodySim-Media-Cache")).toBe("HIT")
    expect(hit.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox",
    )
  }
  expect(new Set(app.cachedKeys).size).toBe(2)
  app.revise("abcdef0123456789abcdef01")
  expect((await app.request()).headers.get("X-CustodySim-Media-Cache")).toBe(
    "MISS",
  )
  expect(new Set(app.cachedKeys).size).toBe(3)
})

test("book cache rejects unexpected MIME types and origin revision mismatches", async () => {
  const app = runtime("book")
  app.contentType("text/html")
  expect(
    (await app.request()).headers.get("X-CustodySim-Media-Cache-Write"),
  ).toBe("SKIP-TYPE")
  expect(app.cache.put).not.toHaveBeenCalled()
  app.mismatch()
  expect((await app.request()).status).toBe(503)
})

test("withdrawn, deleted, logged-out and failed auth requests never access a populated cache", async () => {
  const app = runtime()
  await app.request()
  for (const status of [401, 403, 404, 500]) {
    app.authorize(status)
    const denied = await app.request()
    expect(denied.status).toBe(status === 500 ? 503 : status)
    expect(await denied.text()).toBe("")
  }
  expect(app.cache.match).toHaveBeenCalledTimes(2)
  expect(app.cache.put).toHaveBeenCalledTimes(1)
})

test("authoritative version changes cause misses; mismatched or legacy responses are not cached", async () => {
  const app = runtime()
  await app.request()
  app.revise("1800000000000")
  expect((await app.request()).headers.get("X-CustodySim-Media-Cache")).toBe(
    "MISS",
  )
  expect(app.cachedKeys).toHaveLength(2)
  app.revise("1800000000001")
  app.mismatch()
  expect((await app.request()).status).toBe(503)
  expect(app.cachedKeys).toHaveLength(2)
  const legacy = runtime()
  legacy.noCache()
  await legacy.request()
  await legacy.request()
  expect(legacy.cache.put).not.toHaveBeenCalled()
})

test("HEAD has no body; expired cache entries refetch; disabled feature preserves original auth", async () => {
  const app = runtime()
  await app.request()
  expect(await (await app.request("HEAD")).text()).toBe("")
  app.cache.match.mockRejectedValueOnce(new Error("504 expired"))
  expect((await app.request()).headers.get("X-CustodySim-Media-Cache")).toBe(
    "MISS",
  )
  app.authorize(204)
  app.original(401)
  expect((await app.request()).status).toBe(401)
  expect((await app.request("POST")).status).toBe(405)
})

test("miss diagnostics confirm storage and accept MIME parameters", async () => {
  const app = runtime()
  app.contentType("image/png; charset=binary")
  const miss = await app.request()
  expect(miss.headers.get("X-CustodySim-Media-Cache-Read")).toBe("MISS")
  expect(miss.headers.get("X-CustodySim-Media-Cache-Write")).toBe("STORED")
  const hit = await app.request()
  expect(hit.headers.get("X-CustodySim-Media-Cache-Write")).toBe("NOT-NEEDED")
  expect(await hit.text()).toBe("picture-bytes")
})

test("failed and silently ignored writes still serve authorized bytes with explicit diagnostics", async () => {
  for (const mode of ["throw", "silent"] as const) {
    const app = runtime()
    if (mode === "throw")
      app.cache.put.mockRejectedValue(new Error("413 private user-token"))
    else app.cache.put.mockResolvedValue(undefined)
    const result = await app.request()
    expect(result.status).toBe(200)
    expect(await result.text()).toBe("picture-bytes")
    expect(result.headers.get("Cache-Control")).toBe("private, no-store")
    expect(result.headers.get("X-CustodySim-Media-Cache-Write")).toBe(
      mode === "throw" ? "ERROR" : "NOT-STORED",
    )
    expect(app.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(app.warn.mock.calls)).not.toMatch(
      /private|user-token/,
    )
    expect(result.headers.get("X-CustodySim-Media-Cache-Error")).toBe(
      mode === "throw" ? "413" : null,
    )
    app.authorize(401)
    expect((await app.request()).status).toBe(401)
  }
})

test("skipped and failed cache reads remain distinct from failed writes", async () => {
  const legacy = runtime()
  legacy.noCache()
  expect(
    (await legacy.request()).headers.get("X-CustodySim-Media-Cache-Write"),
  ).toBe("SKIP-LEGACY")
  const svg = runtime()
  svg.contentType("image/svg+xml")
  expect(
    (await svg.request()).headers.get("X-CustodySim-Media-Cache-Write"),
  ).toBe("SKIP-TYPE")
  expect(svg.cache.put).not.toHaveBeenCalled()
  const expired = runtime()
  expired.cache.match.mockRejectedValueOnce(new Error("504 expired"))
  const response = await expired.request()
  expect(response.headers.get("X-CustodySim-Media-Cache-Read")).toBe("ERROR")
  expect(response.headers.get("X-CustodySim-Media-Cache-Write")).toBe("STORED")
})
