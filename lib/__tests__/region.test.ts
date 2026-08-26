import { describe, expect, it } from "vitest"

import {
  getCityCodeByRegionName,
  getRegionByCityCode,
  PROVINCES,
} from "@/lib/region"

describe("region helpers", () => {
  it("provides provinces", () => {
    expect(PROVINCES.length).toBeGreaterThan(10)
  })
  it.each([
    ["110100", "北京市"],
    ["440300", "广东省"],
    ["510100", "四川省"],
  ])("resolves %s", (code, name) => {
    expect(getRegionByCityCode(code)?.name).toBe(name)
  })
  it("returns null for an unknown city", () => {
    expect(getRegionByCityCode("990000")).toBeNull()
  })
  it("resolves a province name", () => {
    expect(getCityCodeByRegionName("上海市")).toBe("310000")
  })
  it("returns null for an unknown province", () => {
    expect(getCityCodeByRegionName("不存在")).toBeNull()
  })
})
