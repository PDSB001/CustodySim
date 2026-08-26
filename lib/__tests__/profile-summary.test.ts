import { describe, expect, it } from "vitest"

import { resolveProfileSummary } from "@/lib/profile-summary"

describe("profile summary archive links", () => {
  it("uses the personnel master record before an archive value", () => {
    const result = resolveProfileSummary({
      chargeName: "诈骗罪",
      sentenceStartDate: null,
      sentenceEndDate: null,
      archiveRecords: [{ data: { 罪名: "盗窃罪" } }],
    })

    expect(result.chargeName).toEqual({ value: "诈骗罪", source: "PERSON" })
  })

  it("fills reserved values from the latest matching archive field", () => {
    const result = resolveProfileSummary({
      chargeName: null,
      sentenceStartDate: null,
      sentenceEndDate: null,
      archiveRecords: [
        {
          data: {
            所犯罪名: "危险驾驶罪",
            刑期开始日期: "2026-01-01",
            刑期结束日期: "2027-01-01",
          },
        },
      ],
    })

    expect(result.chargeName).toEqual({
      value: "危险驾驶罪",
      source: "ARCHIVE",
    })
    expect(result.sentenceStartDate.value).toBe("2026-01-01")
    expect(result.sentenceEndDate.value).toBe("2027-01-01")
  })
})
