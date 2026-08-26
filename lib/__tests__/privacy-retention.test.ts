import { describe, expect, it } from "vitest"

import { GPS_RETENTION_MS, getGpsExpiry } from "@/lib/privacy-retention"

describe("GPS 隐私保留策略", () => {
  it("将精确定位保留期固定为 72 小时", () => {
    expect(GPS_RETENTION_MS).toBe(72 * 60 * 60 * 1000)
  })

  it("从打卡时刻计算精确坐标清除时间", () => {
    const checkinAt = new Date("2026-08-26T08:00:00.000Z")
    expect(getGpsExpiry(checkinAt).toISOString()).toBe(
      "2026-08-29T08:00:00.000Z",
    )
    expect(checkinAt.toISOString()).toBe("2026-08-26T08:00:00.000Z")
  })
})
