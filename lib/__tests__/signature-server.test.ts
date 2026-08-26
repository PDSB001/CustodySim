import { afterEach, describe, expect, it } from "vitest"

import {
  decryptHandwrittenSignature,
  encryptHandwrittenSignature,
  generateFormattedSignatureData,
  generateOfficialSealData,
} from "@/lib/signature-server"

const previousKey = process.env.ARCHIVE_SIGNATURE_ENCRYPTION_KEY
process.env.ARCHIVE_SIGNATURE_ENCRYPTION_KEY =
  "signature-test-key-with-at-least-thirty-two-characters"

afterEach(() => {
  if (previousKey === undefined)
    delete process.env.ARCHIVE_SIGNATURE_ENCRYPTION_KEY
  else process.env.ARCHIVE_SIGNATURE_ENCRYPTION_KEY = previousKey
})

describe("archive signature storage", () => {
  it("encrypts handwritten signatures with an authenticated payload", () => {
    const signature = "data:image/png;base64,c2lnbmF0dXJl"
    const encrypted = encryptHandwrittenSignature(signature)

    expect(encrypted).toMatch(/^v1\./)
    expect(encrypted).not.toContain(signature)
    expect(decryptHandwrittenSignature(encrypted)).toBe(signature)
  })

  it("creates a self-contained formatted signature image", () => {
    expect(generateFormattedSignatureData("张三")).toMatch(
      /^data:image\/svg\+xml;base64,/,
    )
  })

  it("creates a self-contained official seal image", () => {
    expect(generateOfficialSealData()).toMatch(
      /^data:image\/svg\+xml;base64,/,
    )
  })
})
