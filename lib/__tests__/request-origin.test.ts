import { afterEach, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

import { NATIVE_CLIENT_HEADER } from "@/lib/native-client"
import { getTrustedOrigins, isSameOriginMutation } from "@/lib/request-origin"

const APP_ORIGIN = "https://app.example.com"

function write(
  path = "/api/auth/logout",
  headers: Record<string, string> = {},
) {
  return new NextRequest(`${APP_ORIGIN}${path}`, { method: "POST", headers })
}

afterEach(() => vi.unstubAllEnvs())

test("生产环境下缺少 Origin 的写请求被拒绝", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN)
  expect(isSameOriginMutation(write())).toBe(false)
})

test("带原生客户端头的写请求被放行（Origin 豁免已接线）", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN)
  expect(
    isSameOriginMutation(
      write("/api/auth/logout", { [NATIVE_CLIENT_HEADER]: "android-app/1" }),
    ),
  ).toBe(true)
})

test("原生客户端头取值不合约定时不放行", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN)
  for (const value of [
    "",
    "android-app",
    "android-app/x",
    "android-app/1 extra",
    "ios-app/1",
    "android-app/1x",
  ])
    expect(
      isSameOriginMutation(write("/api/auth/logout", { [NATIVE_CLIENT_HEADER]: value })),
    ).toBe(false)
})

test("受信任 Origin 放行，未知 Origin 拒绝", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("APP_ORIGIN", `${APP_ORIGIN},https://example.com`)
  expect(
    isSameOriginMutation(write("/api/checkins", { origin: APP_ORIGIN })),
  ).toBe(true)
  expect(
    isSameOriginMutation(write("/api/checkins", { origin: "https://example.com" })),
  ).toBe(true)
  expect(
    isSameOriginMutation(
      write("/api/checkins", { origin: "https://evil.example.org" }),
    ),
  ).toBe(false)
})

test("生产环境没配 APP_ORIGIN 时一律拒绝，不静默放行", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("APP_ORIGIN", "")
  expect(
    isSameOriginMutation(write("/api/checkins", { origin: APP_ORIGIN })),
  ).toBe(false)
})

test("非写方法与非 /api 路径一律放行", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("APP_ORIGIN", "")
  const read = new NextRequest(`${APP_ORIGIN}/api/checkins`, { method: "GET" })
  expect(isSameOriginMutation(read)).toBe(true)
  expect(isSameOriginMutation(write("/login"))).toBe(true)
})

test("非生产环境放行，且本机来源自动进入可信名单", () => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN)
  expect(isSameOriginMutation(write())).toBe(true)
  expect(
    getTrustedOrigins(
      new NextRequest("http://localhost:3000/api/checkins"),
    ),
  ).toContain("http://localhost:3000")
})
