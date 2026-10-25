import { describe, expect, it } from "vitest"

import {
  formatIpLocationLabel,
  getCheckinLocationText,
} from "@/lib/checkin-location-display"

describe("打卡记录中的 IP 城市显示", () => {
  it("优先显示城市，国家代码转为中文并去除重复名称", () => {
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
    ).toBe("IP 粗略定位：香港")
  })

  it("GPS 打卡保留地址、坐标与附带的 IP 城市位置", () => {
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
    ).toBe("测试地点 · 31.2, 121.5 · IP 粗略定位：上海 · 中国")
  })

  it("重复城市和行政区只显示一次，旧行政区代码不当作名称展示", () => {
    expect(formatIpLocationLabel({ city: "Hong Kong", country: "HK" })).toBe(
      "香港",
    )
    expect(
      formatIpLocationLabel({ label: "NY · US", region: "NY", country: "US" }),
    ).toBe("美国")
    expect(
      formatIpLocationLabel({ city: "北京", region: "北京", country: "CN" }),
    ).toBe("北京 · 中国")
    expect(
      formatIpLocationLabel({ city: "New York", region: "NY", country: "US" }),
    ).toBe("New York · 美国")
  })

  it("兼容仅有旧标签的数据，缺少城市时不伪造城市", () => {
    expect(formatIpLocationLabel({ label: "北京 · CN", country: "CN" })).toBe(
      "北京 · 中国",
    )
    expect(formatIpLocationLabel({ country: "DE" })).toBe("德国")
    expect(formatIpLocationLabel({ label: "IP 粗略定位暂不可用" })).toBeNull()
    expect(
      getCheckinLocationText({ locationSource: "IP", ip: "203.0.113.1" }),
    ).toBe("IP 203.0.113.1")
  })

  it("GPS 清理后仅展示 IP 城市，不恢复历史地址或坐标", () => {
    expect(
      getCheckinLocationText({
        locationSource: "GPS_PURGED",
        location: {
          address: "不应显示",
          lat: 1,
          ip: { city: "北京", country: "CN" },
        },
        lat: "1",
        lng: "2",
      }),
    ).toBe("IP 粗略定位：北京 · 中国 · GPS 坐标已按保留策略清除")
  })
})
