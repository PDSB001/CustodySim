import { describe, expect, it } from "vitest"

import {
  buildCode,
  extractSequentialCodeNumber,
  formatDatePart,
  getHighestSequentialCodeNumber,
} from "@/lib/numbering"

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
  it("uses the Shanghai date rather than the server local timezone", () => {
    expect(
      formatDatePart(new Date("2026-08-24T16:30:00.000Z"), "yyyyMMdd"),
    ).toBe("20260825")
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

  it("extracts a sequential archive number only when it matches the active rule", () => {
    expect(
      extractSequentialCodeNumber({
        code: "ARC2026080012",
        prefix: "ARC",
        dateFormat: "yyyyMM",
        minLength: 4,
      }),
    ).toBe(12)
    expect(
      extractSequentialCodeNumber({
        code: "OTHER2026080012",
        prefix: "ARC",
        dateFormat: "yyyyMM",
        minLength: 4,
      }),
    ).toBeNull()
  })

  it("recalculates the next sequence from remaining records after deletion", () => {
    expect(
      getHighestSequentialCodeNumber({
        codes: ["ARC2026080002", "ARC2026080011", "invalid"],
        prefix: "ARC",
        dateFormat: "yyyyMM",
        minLength: 4,
      }),
    ).toBe(11)
    expect(
      getHighestSequentialCodeNumber({
        codes: [],
        prefix: "ARC",
        dateFormat: "yyyyMM",
        minLength: 4,
      }),
    ).toBe(0)
  })

  it("keeps a long remaining sequence when recalculating", () => {
    expect(
      getHighestSequentialCodeNumber({
        codes: ["ARC2026089999", "ARC20260810000"],
        prefix: "ARC",
        dateFormat: "yyyyMM",
        minLength: 4,
      }),
    ).toBe(10000)
  })
})
