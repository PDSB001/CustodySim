import { expect, test } from "vitest"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { config } from "@/proxy"
import { proxy } from "@/proxy"
import { NextRequest } from "next/server"
test("只有 APK 管理接口跳过 Proxy 缓冲，其余 API 继续接受来源检查", () => {
  const match = (url: string) =>
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })
  expect(match("/api/admin/app-release")).toBe(false)
  expect(match("/api/admin/app-release-other")).toBe(true)
  expect(match("/api/admin/users")).toBe(true)
  expect(match("/api/app-download/apk")).toBe(true)
  expect(match("/app-release")).toBe(true)
})

test("Proxy 保留 APK 下载自己的缓存策略，其他 API 仍禁止缓存", () => {
  const download = proxy(
    new NextRequest("https://example.test/api/app-download/apk"),
  )
  expect(download.headers.has("cache-control")).toBe(false)
  const normal = proxy(new NextRequest("https://example.test/api/admin/users"))
  expect(normal.headers.get("cache-control")).toBe("private, no-store")
})
