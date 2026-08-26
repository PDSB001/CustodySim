import { describe, expect, it } from "vitest"

import { computePasswordMeta, validatePassword } from "@/lib/password-rule"

describe("password rules", () => {
  it("computes password metadata", () => {
    expect(computePasswordMeta("Abc123!x")).toEqual({
      length: 8,
      hasDigit: true,
      hasLetter: true,
      hasSpecial: true,
    })
  })
  it("accepts a valid password", () => {
    expect(validatePassword("Abc12345").valid).toBe(true)
  })
  it("rejects a short password", () => {
    expect(validatePassword("Ab1").errors).toContain("密码至少需要 8 位")
  })
  it("rejects a password without letters", () => {
    expect(validatePassword("12345678").errors).toContain(
      "密码至少包含一个字母",
    )
  })
  it("rejects a password without digits", () => {
    expect(validatePassword("abcdefgh").errors).toContain(
      "密码至少包含一个数字",
    )
  })
  it("rejects overly long password", () => {
    expect(validatePassword("A1".repeat(65)).errors).toContain(
      "密码不能超过 128 位",
    )
  })
})
