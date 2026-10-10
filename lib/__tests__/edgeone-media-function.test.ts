import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { runInNewContext } from "node:vm"
import { expect, test, vi } from "vitest"

const source = readFileSync(
  new URL("../../deploy/edgeone/media-cache.js", import.meta.url),
  "utf8",
)

function runtime() {
  const id = randomUUID()
  const path = `/api/chat/messages/${id}/image`
  const entries = new Map<string, Response>()
  const cachedKeys: string[] = []
  let authStatus = 200
  let version = "0"
  let cacheable = true
  let originalStatus = 200
  let contentRevision: string | null = null
  const fetch = vi.fn(async (input: Request | string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    if (url.pathname === "/api/media/authorize") {
      expect(url.searchParams.get("target")).toBe(path)
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer user-token",
      )
      return authStatus === 200
        ? Response.json({
            kind: "chat",
            id,
            revision: version,
            permit: "signed-origin-permit",
            cacheable,
          })
        : new Response(null, { status: authStatus })
    }
    if (url.pathname === "/api/media/content") {
      expect(new Headers(init?.headers).get("x-custodysim-media-permit")).toBe(
        "signed-origin-permit",
      )
      return new Response("picture-bytes", {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
          "Set-Cookie": "must-not-be-stored",
          "X-CustodySim-Media-Revision": contentRevision ?? version,
        },
      })
    }
    if (url.pathname === path)
      return new Response("original", { status: originalStatus })
    throw new Error("Unexpected fetch target")
  })
  const cache = {
    match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => {
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=86400",
      )
      expect(response.headers.has("set-cookie")).toBe(false)
      expect(response.headers.has("vary")).toBe(false)
      cachedKeys.push(key.url)
      entries.set(key.url, response.clone())
    }),
  }
  let listener: (event: unknown) => void = () => {
    throw new Error("Missing listener")
  }
  runInNewContext(source, {
    Request,
    Response,
    Headers,
    URL,
    fetch,
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
    cachedKeys,
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
    original: (status: number) => {
      originalStatus = status
    },
    async request(method = "GET", target = path) {
      const pending: Promise<unknown>[] = []
      let response: Promise<Response> | undefined
      listener({
        request: new Request(`https://site.test${target}`, {
          method,
          headers: {
            authorization: "Bearer user-token",
            "x-custodysim-media-permit": "attacker-value",
          },
        }),
        waitUntil: (job: Promise<unknown>) => {
          pending.push(job)
        },
        respondWith: (job: Promise<Response>) => {
          response = job
        },
      })
      const result = await response!
      await Promise.all(pending)
      return result
    },
  }
}

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
  expect(
    (await app.request("GET", new URL(app.cachedKeys[0]).pathname)).status,
  ).toBe(404)
  expect(app.cache.match).toHaveBeenCalledTimes(2)
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
  expect(app.cache.match).toHaveBeenCalledTimes(1)
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
