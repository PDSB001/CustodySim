import { describe, expect, it } from "vitest"

import {
  getDailyCheckinScore,
  getShanghaiWeekKey,
  getTaskOutcomeWeekKey,
  getTaskOutcomeScoreDelta,
  isWeeklyReviewWindowOpen,
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

  it("周结等待周一跨日后的日结安全窗", () => {
    expect(isWeeklyReviewWindowOpen(new Date("2026-08-30T16:09:59.999Z"))).toBe(
      false,
    )
    expect(isWeeklyReviewWindowOpen(new Date("2026-08-30T16:10:00.000Z"))).toBe(
      true,
    )
  })

  it("跨周处理的任务积分仍归属任务发生周", () => {
    const sundayTask = new Date("2026-08-30T15:30:00.000Z")
    const mondayProcessingTime = new Date("2026-08-30T16:02:00.000Z")
    expect(getTaskOutcomeWeekKey(sundayTask)).toBe("2026-08-24")
    expect(getShanghaiWeekKey(mondayProcessingTime)).toBe("2026-08-31")
  })

  it("按每日打卡完成度结算，不因打卡次数不同而失衡", () => {
    expect(
      getDailyCheckinScore({
        normalCheckinCount: 4,
        makeupCount: 0,
        missingCount: 0,
      }),
    ).toBe(5)
    expect(
      getDailyCheckinScore({
        normalCheckinCount: 3,
        makeupCount: 1,
        missingCount: 0,
      }),
    ).toBe(4)
    expect(
      getDailyCheckinScore({
        normalCheckinCount: 2,
        makeupCount: 0,
        missingCount: 2,
      }),
    ).toBe(1)
    expect(
      getDailyCheckinScore({
        normalCheckinCount: 1,
        makeupCount: 0,
        missingCount: 3,
      }),
    ).toBe(0)
    expect(
      getDailyCheckinScore({
        normalCheckinCount: 0,
        makeupCount: 2,
        missingCount: 4,
      }),
    ).toBe(-8)
  })
})
