import { describe, expect, it } from "vitest"

import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashRecoveryCode,
  hashTrustedDeviceToken,
  parseTrustedDeviceCookie,
  verifyTotpCode,
} from "@/lib/mfa"

process.env.AUTH_SECRET =
  "test-auth-secret-that-is-longer-than-thirty-two-characters"

describe("MFA helpers", () => {
  it("accepts the current TOTP window and rejects a wrong code", () => {
    // RFC 6238's SHA-1 test secret. At timestamp 59, the 6-digit code is 287082.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    expect(verifyTotpCode(secret, "287082", 59_000)).toBe(true)
    expect(verifyTotpCode(secret, "287083", 59_000)).toBe(false)
  })

  it("encrypts the verification secret without preserving plaintext", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP")
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP")
    expect(decryptMfaSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP")
  })

  it("normalizes recovery codes and parses trusted device cookies", () => {
    expect(hashRecoveryCode("ABCD-EFGH-IJKL")).toBe(
      hashRecoveryCode("abcd efgh ijkl"),
    )
    const token = "a".repeat(43)
    const deviceId = "11111111-1111-4111-8111-111111111111"
    expect(parseTrustedDeviceCookie(`${deviceId}.${token}`)).toEqual({
      deviceId,
      token,
    })
    expect(parseTrustedDeviceCookie("invalid")).toBeNull()
    expect(
      parseTrustedDeviceCookie(`11111111----------------------------.${token}`),
    ).toBeNull()
    expect(
      parseTrustedDeviceCookie(`11111111-1111-4111-8111-11111111111g.${token}`),
    ).toBeNull()
    expect(hashTrustedDeviceToken(token)).toHaveLength(64)
  })
})
