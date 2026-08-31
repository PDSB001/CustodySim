import { describe, expect, it } from "vitest"

import {
  LOGIN_RATE_LIMIT_BLOCK_MS,
  LOGIN_RATE_LIMIT_MAX_FAILURES,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  getLoginRateLimitKeys,
} from "@/lib/login-rate-limit"

describe("login rate limit", () => {
  it("uses bounded account and network rate-limit windows", () => {
    expect(LOGIN_RATE_LIMIT_MAX_FAILURES).toBe(5)
    expect(LOGIN_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000)
    expect(LOGIN_RATE_LIMIT_BLOCK_MS).toBe(15 * 60 * 1000)
  })

  it("does not create a shared unknown-network bucket without a trusted IP", () => {
    expect(getLoginRateLimitKeys("admin", null)).toHaveLength(1)
  })

  it("hashes account and network identifiers into separate stable keys", () => {
    const keys = getLoginRateLimitKeys(" Admin ", "203.0.113.7")
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(keys[1]).toMatch(/^[a-f0-9]{64}$/)
    expect(keys[0]).not.toBe(keys[1])
    expect(getLoginRateLimitKeys("admin", "203.0.113.7")[0]).toBe(keys[0])
    expect(getLoginRateLimitKeys("admin", "203.0.113.8")[1]).not.toBe(keys[1])
  })
})
