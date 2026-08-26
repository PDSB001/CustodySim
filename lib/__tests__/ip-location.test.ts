import { describe, expect, it } from "vitest"

import { getCoarseIpLocation } from "@/lib/ip-location"

describe("本地 IP 粗略定位", () => {
  it("未提供 IP 时不伪造地理位置", () => {
    expect(getCoarseIpLocation(null)).toEqual({
      source: "IP",
      precision: "CITY",
      label: "IP 粗略定位暂不可用",
      country: null,
      region: null,
      city: null,
      timezone: null,
    })
  })

  it("仅返回城市级字段，不暴露 IP 库的坐标范围", () => {
    const location = getCoarseIpLocation("8.8.8.8")
    expect(location.source).toBe("IP")
    expect(location.precision).toBe("CITY")
    expect(Object.keys(location)).not.toContain("ll")
    expect(Object.keys(location)).not.toContain("lat")
    expect(Object.keys(location)).not.toContain("lng")
  })
})
