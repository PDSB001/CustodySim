import { describe, expect, it } from "vitest"

import {
  getDailyCheckinScore,
  getShanghaiWeekKey,
  getTaskOutcomeScoreDelta,
} from "@/lib/scoring"

describe("积分与周结算规则", () => {
  it("按上海时区归属到周一开始的自然周", () => {
    expect(getShanghaiWeekKey(new Date("2026-08-30T15:59:00Z"))).toBe(
      "2026-08-24",
    )
    expect(getShanghaiWeekKey(new Date("2026-08-30T16:00:00Z"))).toBe(
      "2026-08-31",
    )
  })

  it("按任务最终结果计分，评分和中间打回不单独计分", () => {
    expect(getTaskOutcomeScoreDelta({ returnedBeforeApproval: false })).toBe(2)
    expect(getTaskOutcomeScoreDelta({ returnedBeforeApproval: true })).toBe(1)
  })

  it("按每日打卡完成度结算，不因打卡次数不同而失衡", () => {
    expect(getDailyCheckinScore({ normalCheckinCount: 4, makeupCount: 0, missingCount: 0 })).toBe(5)
    expect(getDailyCheckinScore({ normalCheckinCount: 3, makeupCount: 1, missingCount: 0 })).toBe(4)
    expect(getDailyCheckinScore({ normalCheckinCount: 2, makeupCount: 0, missingCount: 2 })).toBe(1)
    expect(getDailyCheckinScore({ normalCheckinCount: 1, makeupCount: 0, missingCount: 3 })).toBe(0)
    expect(getDailyCheckinScore({ normalCheckinCount: 0, makeupCount: 2, missingCount: 4 })).toBe(-8)
  })
})
