import { describe, expect, it } from "vitest"

import { buildCode, formatDatePart } from "@/lib/numbering"

const date = new Date("2026-08-25T00:00:00.000Z")

describe("numbering", () => {
  it.each([
    ["yyyy", "2026"],
    ["yy", "26"],
    ["yyyyMM", "202608"],
    ["yyyyMMdd", "20260825"],
  ])("formats %s", (format, expected) => {
    expect(formatDatePart(date, format)).toBe(expected)
  })
  it("pads a sequence", () => {
    expect(buildCode({ prefix: "CS", date, sequence: 7 })).toBe("CS2026080007")
  })
  it("uses custom length", () => {
    expect(
      buildCode({
        prefix: "P-",
        date,
        dateFormat: "yyyy",
        sequence: 12,
        minLength: 2,
      }),
    ).toBe("P-202612")
  })
  it("keeps long sequence intact", () => {
    expect(
      buildCode({ prefix: "X", date, sequence: 12345, minLength: 4 }),
    ).toBe("X20260812345")
  })
})
