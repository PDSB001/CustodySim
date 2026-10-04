import { describe, expect, it } from "vitest"
import {
  BOOK_MAX_BYTES,
  creditedReadingSeconds,
  validateBook,
} from "@/lib/library"
import { ReportTemplateSchema } from "@/lib/admin-schemas"

describe("library upload and reading policy", () => {
  it("accepts Chinese UTF-8 text and PDF signatures", () => {
    expect(validateBook(Buffer.from("读书使人明智。"), "阅读.txt")).toBe("TXT")
    expect(validateBook(Buffer.from("%PDF-1.7\n"), "阅读.PDF")).toBe("PDF")
  })
  it("rejects disguised binaries, invalid encoding, unsupported formats and excessive files", () => {
    expect(() =>
      validateBook(Buffer.from("<script>bad</script>"), "fake.pdf"),
    ).toThrow()
    expect(() =>
      validateBook(new Uint8Array([0xff, 0xfe]), "book.txt"),
    ).toThrow("UTF-8")
    expect(() => validateBook(new Uint8Array([0]), "book.txt")).toThrow()
    expect(() => validateBook(Buffer.from("PK"), "book.epub")).toThrow()
    expect(() =>
      validateBook(new Uint8Array(BOOK_MAX_BYTES + 1), "book.txt"),
    ).toThrow("20 MB")
    expect(() => validateBook(new Uint8Array(), "book.txt")).toThrow()
  })
  it("credits the preceding active period on pause, and no paused period on resume", () => {
    const at = new Date("2026-10-04T00:00:00Z")
    expect(
      creditedReadingSeconds(at, new Date(at.getTime() + 15000), true),
    ).toBe(15)
    expect(
      creditedReadingSeconds(at, new Date(at.getTime() + 15000), false),
    ).toBe(0)
    expect(
      creditedReadingSeconds(at, new Date(at.getTime() + 30000), true),
    ).toBe(0)
    expect(creditedReadingSeconds(at, at, true)).toBe(0)
    expect(
      creditedReadingSeconds(at, new Date(at.getTime() - 1000), true),
    ).toBe(0)
  })
  it("preserves old templates and rejects impossible reading requirements", () => {
    const template = {
      name: "学习心得",
      kind: "STUDY",
      fields: [{ name: "心得", type: "TEXTAREA" }],
    }
    expect(ReportTemplateSchema.parse(template).readingMinutes).toBe(0)
    expect(
      ReportTemplateSchema.parse({ ...template, readingMinutes: 30 })
        .readingMinutes,
    ).toBe(30)
    for (const readingMinutes of [-1, 1.5, 1441])
      expect(
        ReportTemplateSchema.safeParse({ ...template, readingMinutes }).success,
      ).toBe(false)
  })
})
