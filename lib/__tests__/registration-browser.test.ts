import { afterEach, expect, test, vi } from "vitest"
import {
  browserHash,
  registrationBrowserCookie,
  registrationNetwork,
  registrationRisk,
} from "@/lib/registration-browser"
afterEach(() => vi.unstubAllEnvs())
test("signed browser identity rejects tampering and keeps network identifiers private", () => {
  vi.stubEnv("AUTH_SECRET", "a".repeat(48))
  const cookie = registrationBrowserCookie()
  expect(registrationBrowserCookie(cookie)).toBe(cookie)
  expect(browserHash(cookie)).toHaveLength(64)
  expect(
    browserHash(cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a")),
  ).toBeNull()
  expect(registrationRisk(undefined, "1.2.3.4")).toBeNull()
  const risk = registrationRisk(cookie, "1.2.3.4")!
  expect(risk.networkHash).toHaveLength(64)
  expect(JSON.stringify(risk)).not.toContain("1.2.3.4")
  expect(registrationRisk(cookie, null)?.networkHash).toBeNull()
})
test("IPv6 spellings, /64 addresses and IPv4 mapped forms share network quotas", () => {
  expect(registrationNetwork("2001:db8:1:2::1")).toBe(
    registrationNetwork("2001:0db8:0001:0002:ffff:0:0:1234"),
  )
  expect(registrationNetwork("::ffff:192.0.2.1")).toBe(
    registrationNetwork("192.0.2.1"),
  )
  expect(registrationNetwork("::ffff:c000:201")).toBe(
    registrationNetwork("192.0.2.1"),
  )
  expect(registrationNetwork("::1")).toBe("v6:0:0:0:0/64")
  expect(registrationNetwork("garbage")).toBeNull()
})
