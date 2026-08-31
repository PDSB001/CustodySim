import { afterEach, describe, expect, it, vi } from "vitest"

import { getRequestIp } from "@/lib/request-ip"

afterEach(() => vi.unstubAllEnvs())

describe("trusted request IP", () => {
  it("ignores forwarding headers in production unless the proxy is trusted", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TRUST_PROXY", "false")
    expect(getRequestIp(new Headers({ "x-real-ip": "203.0.113.7" }))).toBeNull()
  })

  it("prefers a proxy-overwritten valid X-Real-IP", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TRUST_PROXY", "true")
    expect(
      getRequestIp(
        new Headers({
          "x-real-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.9, 192.0.2.4",
        }),
      ),
    ).toBe("203.0.113.7")
  })

  it("never trusts the client-controlled first forwarded address", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TRUST_PROXY", "true")
    expect(
      getRequestIp(
        new Headers({
          "x-real-ip": "invalid",
          "x-forwarded-for": "198.51.100.9, 192.0.2.4",
        }),
      ),
    ).toBe("192.0.2.4")
  })
})
