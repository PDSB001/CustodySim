import { describe, expect, it } from "vitest"

import { getCheckinLocationText } from "@/lib/checkin-location-display"

describe("打卡记录中的 IP 城市显示", () => {
  const attribution =
    "IP 粗略定位（Merged-IP 数据：GeoLite2 by MaxMind、IP Geolocation by DB-IP）"

  it("显示城市级位置和数据归属", () => {
    expect(
      getCheckinLocationText({
        locationSource: "IP",
        location: null,
        ipLocation: {
          source: "IP",
          precision: "CITY",
          label: "香港 · HK",
          country: "HK",
          region: null,
          city: "香港",
          timezone: "Asia/Hong_Kong",
        },
        ip: "212.107.29.198",
      }),
    ).toBe(`${attribution}：香港 · HK`)
  })

  it("GPS 打卡中也标明附带的 IP 粗略定位来源", () => {
    expect(
      getCheckinLocationText({
        locationSource: "GPS",
        location: {
          address: "测试地点",
          ip: { label: "上海 · CN", city: "上海", country: "CN" },
        },
        ipLocation: null,
        lat: "31.2",
        lng: "121.5",
      }),
    ).toContain(`${attribution}：上海 · CN`)
  })
})
