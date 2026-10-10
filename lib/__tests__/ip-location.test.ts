import { describe, expect, it } from "vitest"

import { getCoarseIpLocation, getRecordIpLocation } from "@/lib/ip-location"

describe("本地 IP 粗略定位", () => {
  it("优先沿用历史地点快照，缺失时才按 IP 解析", () => {
    expect(
      getRecordIpLocation({
        locationSource: "IP",
        location: {
          label: "旧快照城市",
          country: "CN",
          city: "旧快照城市",
          ll: [0, 0],
        },
        ip: "8.8.8.8",
      }),
    ).toMatchObject({ label: "旧快照城市", country: "CN", city: "旧快照城市" })
    expect(
      getRecordIpLocation({
        locationSource: "IP",
        location: null,
        ip: "8.8.8.8",
      }),
    ).toEqual(getCoarseIpLocation("8.8.8.8"))
  })
  it("系统记录不解析 IP；GPS 保留期后只解析城市，不恢复坐标", () => {
    expect(
      getRecordIpLocation({
        locationSource: "SYSTEM",
        location: null,
        ip: "8.8.8.8",
      }),
    ).toBeNull()
    const location = getRecordIpLocation({
      locationSource: "GPS_PURGED",
      location: { address: "旧地址", lat: 1 },
      ip: "8.8.8.8",
    })
    expect(location).toEqual(getCoarseIpLocation("8.8.8.8"))
    expect(location).not.toHaveProperty("lat")
    expect(location).not.toHaveProperty("address")
  })
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
