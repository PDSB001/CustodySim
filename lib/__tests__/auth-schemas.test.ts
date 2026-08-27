import { describe, expect, it } from "vitest"

import { ChangePasswordSchema } from "@/lib/auth-schemas"

describe("ChangePasswordSchema", () => {
  const valid = {
    currentPassword: "Current123",
    newPassword: "NewPassword123",
    confirmPassword: "NewPassword123",
  }

  it("accepts a confirmed password with letters and digits", () => {
    expect(ChangePasswordSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects mismatched confirmation", () => {
    const result = ChangePasswordSchema.safeParse({
      ...valid,
      confirmPassword: "Different123",
    })
    expect(result.success).toBe(false)
  })

  it("rejects passwords without letters or digits", () => {
    expect(
      ChangePasswordSchema.safeParse({ ...valid, newPassword: "12345678" })
        .success,
    ).toBe(false)
    expect(
      ChangePasswordSchema.safeParse({ ...valid, newPassword: "abcdefgh" })
        .success,
    ).toBe(false)
  })
})
