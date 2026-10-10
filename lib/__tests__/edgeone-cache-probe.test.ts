import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { expect, test, vi } from "vitest"

test("standalone probe separates request format, policy and namespace failures without application fetches", async () => {
  const source = readFileSync(
    new URL("../../deploy/edgeone/cache-probe.js", import.meta.url),
    "utf8",
  )
  const fetch = vi.fn(() => {
    throw new Error("Probe must not fetch application data")
  })
  let listener: (event: unknown) => void = () => {}
  runInNewContext(source, {
    Request,
    Response,
    URL,
    fetch,
    caches: {
      open: async (namespace: string) => ({
        put: async (key: Request | string, response: Response) => {
          if (key instanceof Request)
            throw new TypeError("request format rejected")
          if (key.includes("/__custodysim_media_cache/"))
            throw Object.assign(new Error("cache policy rejected"), {
              status: 413,
            })
          if (namespace === "default")
            throw new Error("namespace backend unavailable")
          expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=60, max-age=60",
          )
          expect(response.headers.has("Set-Cookie")).toBe(false)
          expect(await response.text()).toBe("custodysim-public-cache-probe-v1")
        },
        match: async () => new Response("public test only"),
      }),
    },
    addEventListener: (_: string, callback: typeof listener) => {
      listener = callback
    },
  })
  async function request(path = "/__custodysim_cache_probe", method = "GET") {
    let response: Promise<Response> | undefined
    listener({
      request: new Request(`https://site.test${path}`, {
        method,
        headers: {
          cookie: "session=private-cookie",
          authorization: "Bearer private-token",
        },
      }),
      respondWith: (job: Promise<Response>) => {
        response = job
      },
    })
    return response!
  }
  const response = await request()
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  const report = await response.json()
  expect(report.results[0]).toMatchObject({
    stage: "put",
    error: { name: "TypeError", message: "request format rejected" },
  })
  expect(report.results[1]).toMatchObject({
    stage: "put",
    error: { status: "413" },
  })
  expect(report.results[2]).toMatchObject({
    stage: "done",
    hit: true,
    status: 200,
  })
  expect(report.results[3]).toMatchObject({
    stage: "put",
    error: { message: "namespace backend unavailable" },
  })
  expect(JSON.stringify(report)).not.toMatch(/private-cookie|private-token/)
  expect((await request("/api/chat/messages/example/image")).status).toBe(404)
  expect((await request("/__custodysim_cache_probe", "POST")).status).toBe(404)
  expect(fetch).not.toHaveBeenCalled()
})
