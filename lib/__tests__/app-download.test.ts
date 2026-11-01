import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const testFiles = vi.hoisted(() => ({ root: "" }))
vi.mock("@/lib/app-download", async () => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  const name = (kind: string) => path.join(testFiles.root, kind)
  return {
    appDownloadPath: name,
    appDownloadAvailable: async (kind: string) => {
      try {
        return (await fs.stat(name(kind))).isFile()
      } catch {
        return false
      }
    },
  }
})
import { GET, HEAD } from "@/app/api/app-download/[kind]/route"

beforeAll(async () => {
  testFiles.root = await mkdtemp(
    path.join(tmpdir(), "custodysim-download-test-"),
  )
})
beforeEach(async () => {
  await rm(path.join(testFiles.root, "apk"), { force: true })
})

test("APK 支持范围续传、条件缓存、版本变化后完整重下和 HEAD", async () => {
  await writeFile(path.join(testFiles.root, "apk"), "0123456789")
  const context = { params: Promise.resolve({ kind: "apk" }) }
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://example.test/api/app-download/apk", { headers })
  const full = await GET(request(), context)
  const etag = full.headers.get("etag")!
  expect(await full.text()).toBe("0123456789")
  expect(full.headers.get("cache-control")).toBe("public, no-cache")
  const versioned = await GET(
    new Request(
      `https://example.test/api/app-download/apk?v=${etag.slice(1, -1)}`,
    ),
    context,
  )
  expect(versioned.headers.get("cache-control")).toBe(
    "public, max-age=0, s-maxage=86400",
  )
  expect(await versioned.text()).toBe("0123456789")
  const partial = await GET(
    request({ range: "bytes=4-", "if-range": etag }),
    context,
  )
  expect(partial.status).toBe(206)
  expect(partial.headers.get("content-range")).toBe("bytes 4-9/10")
  expect(partial.headers.get("content-length")).toBe("6")
  expect(await partial.text()).toBe("456789")
  const suffix = await GET(request({ range: "bytes=-3" }), context)
  expect(await suffix.text()).toBe("789")
  const invalid = await GET(request({ range: "bytes=10-" }), context)
  expect(invalid.status).toBe(416)
  expect(invalid.headers.get("content-range")).toBe("bytes */10")
  expect((await GET(request({ "if-none-match": etag }), context)).status).toBe(
    304,
  )
  const head = await HEAD(request(), context)
  expect(head.headers.get("content-length")).toBe("10")
  expect(await head.text()).toBe("")
  await writeFile(path.join(testFiles.root, "apk"), "new-package")
  const changed = await GET(
    request({ range: "bytes=4-", "if-range": etag }),
    context,
  )
  expect(changed.status).toBe(200)
  expect(changed.headers.get("etag")).not.toBe(etag)
  expect(await changed.text()).toBe("new-package")
  const stale = await GET(
    new Request(
      `https://example.test/api/app-download/apk?v=${etag.slice(1, -1)}`,
    ),
    context,
  )
  expect(stale.status).toBe(404)
  expect(stale.headers.get("cache-control")).toBe("no-store")
})
afterAll(async () => {
  if (testFiles.root) await rm(testFiles.root, { recursive: true, force: true })
})
const get = (kind: string) =>
  GET(new Request("https://example.test"), {
    params: Promise.resolve({ kind }),
  })

test("只提供 APK，缺失文件返回 404，源码即使存在也不开放下载", async () => {
  expect((await get("other")).status).toBe(404)
  expect((await get("apk")).status).toBe(404)
  await writeFile(path.join(testFiles.root, "apk"), "apk-data")
  await writeFile(path.join(testFiles.root, "source"), "source-data")
  const response = await get("apk")
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe(
    "application/vnd.android.package-archive",
  )
  expect(await response.text()).toBe("apk-data")
  expect((await get("source")).status).toBe(404)
})
