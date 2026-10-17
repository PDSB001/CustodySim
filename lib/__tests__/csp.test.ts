import { NextRequest } from "next/server"
import { afterEach, expect, test, vi } from "vitest"
import { proxy } from "@/proxy"

afterEach(() => vi.unstubAllEnvs())

test("production uses nonce and strict-dynamic without trusting a request Host for realtime", () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("NEXT_PUBLIC_CHAT_REALTIME_URL", "")
  const response = proxy(
    new NextRequest("https://app.example/my", {
      headers: { host: "untrusted.example" },
    }),
  )
  const csp = response.headers.get("Content-Security-Policy")
  expect(csp).toContain("'strict-dynamic'")
  expect(csp).toMatch(/'nonce-[a-f0-9]+'/)
  expect(csp).not.toContain("untrusted.example")
})

test("development bind address does not replace the browser websocket hostname", () => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("NEXT_PUBLIC_CHAT_REALTIME_URL", "")
  const response = proxy(
    new NextRequest("http://0.0.0.0:3102/my/chat", {
      headers: { host: "127.0.0.1:3102" },
    }),
  )
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "ws://127.0.0.1:3001",
  )
})
