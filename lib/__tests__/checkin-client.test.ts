import { expect, it } from "vitest"
import { getCheckinClientInfo } from "@/lib/checkin-client"
import { getCheckinLocationText } from "@/lib/checkin-location-display"

it("旧 WEB/OkHttp 记录显示为 App，原始 UA 留作展开查看", () => {
  expect(
    getCheckinClientInfo({ clientType: "WEB", browserType: "okhttp/4.12.0" }),
  ).toEqual({
    clientType: "APP",
    label: "App",
    browserName: null,
    userAgent: "okhttp/4.12.0",
  })
  expect(
    getCheckinClientInfo({
      clientType: "APP",
      browserType: "Mozilla/5.0 Chrome/130.0",
    }).label,
  ).toBe("App")
  expect(
    getCheckinClientInfo({ clientType: "SYSTEM", browserType: "okhttp/4.12.0" })
      .label,
  ).toBe("系统")
})

it.each([
  ["Mozilla/5.0 Chrome/130.0 Safari/537.36 Edg/130.1", "Edge 130.1"],
  ["Mozilla/5.0 Chrome/130.0 Safari/537.36 OPR/115.0", "Opera 115.0"],
  ["Mozilla/5.0 Version/18.0 Mobile/15 Safari/604.1", "Safari 18.0"],
  ["Mozilla/5.0 FxiOS/130.0 Mobile/15 Safari/604.1", "Firefox 130.0"],
])("识别浏览器且不把兼容标识误当 Chrome: %s", (userAgent, browserName) => {
  expect(
    getCheckinClientInfo({ clientType: "WEB", userAgent }).browserName,
  ).toBe(browserName)
})

it("未记录 UA 的记录不伪造客户端或浏览器", () => {
  expect(
    getCheckinClientInfo({ clientType: null, browserType: null }),
  ).toMatchObject({
    clientType: null,
    browserName: null,
    userAgent: null,
  })
})

it("IP 地点读取 label，旧响应不用新字段也能展示", () => {
  expect(
    getCheckinLocationText({
      locationSource: "IP",
      location: { label: "北京 · CN" },
      ip: "203.0.113.7",
    }),
  ).toBe("北京 · CN")
  expect(
    getCheckinLocationText({
      locationSource: "IP",
      location: null,
      ipLocation: { label: "上海 · CN" },
      ip: "203.0.113.7",
    }),
  ).toBe("上海 · CN")
})

it("GPS 清除后只展示保留的 IP 粗略地点，不重新暴露旧地址或坐标", () => {
  const result = getCheckinLocationText({
    locationSource: "GPS_PURGED",
    location: { address: "旧的精确地址", ip: { label: "北京 · CN" } },
    lat: "39.9",
    lng: "116.4",
  })
  expect(result).toContain("北京 · CN")
  expect(result).toContain("GPS 坐标已按保留策略清除")
  expect(result).not.toContain("旧的精确地址")
  expect(result).not.toContain("39.9")
})
