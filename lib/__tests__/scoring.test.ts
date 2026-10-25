import { describe, expect, it } from "vitest"

import {
  getDailyCheckinScore,
  getShanghaiWeekKey,
  getTaskOutcomeWeekKey,
  getTaskOutcomeScoreDelta,
  getWeeklyReviewResult,
  isWeeklyReviewWindowOpen,
  scoreBreakdown,
} from "@/lib/scoring"

/** 只提供周结判定需要的那一次聚合查询。 */
function attendanceExecutor(slots: number, attended: number) {
  return {
    select: () => ({
      from: () => ({ where: async () => [{ slots, attended }] }),
    }),
  } as never
}

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
    expect(getTaskOutcomeScoreDelta({ returnedBeforeApproval: false })).toBe(3)
    expect(getTaskOutcomeScoreDelta({ returnedBeforeApproval: true })).toBe(2)
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

  it("按打卡时段线性计分，缺卡可以直接扣成负分", () => {
    expect(
      getDailyCheckinScore({
        completedCount: 4,
        makeupCount: 0,
        missingCount: 0,
      }),
    ).toBe(4)
    expect(
      getDailyCheckinScore({
        completedCount: 3,
        makeupCount: 1,
        missingCount: 0,
      }),
    ).toBe(2)
    // 只打 1 次、缺 3 次：旧口径被 0 分地板截断，新口径如实扣分。
    expect(
      getDailyCheckinScore({
        completedCount: 1,
        makeupCount: 0,
        missingCount: 3,
      }),
    ).toBe(-5)
    expect(
      getDailyCheckinScore({
        completedCount: 0,
        makeupCount: 2,
        missingCount: 4,
      }),
    ).toBe(-10)
  })

  it("禁闭要总分为负且出勤不足一半，两个条件缺一不可", async () => {
    // 出勤 2/3，虽然分数为负但人一直到场 → 不禁闭。
    expect(
      await getWeeklyReviewResult("u", "2026-10-19", -4, attendanceExecutor(30, 20)),
    ).toBe("CLEAR")
    // 出勤 1/3 且分数为负 → 禁闭。
    expect(
      await getWeeklyReviewResult("u", "2026-10-19", -2, attendanceExecutor(30, 10)),
    ).toBe("ISOLATION")
    // 全勤但分数非负 → 不禁闭。
    expect(
      await getWeeklyReviewResult("u", "2026-10-19", 6, attendanceExecutor(30, 30)),
    ).toBe("CLEAR")
    // 该周没有打卡排班：退回纯分数线判定。
    expect(
      await getWeeklyReviewResult("u", "2026-10-19", -1, attendanceExecutor(0, 0)),
    ).toBe("ISOLATION")
  })

  it("分项按来源汇总，且各项之和等于总分", () => {
    const events = [
      { source: "CHECKIN_DAILY", points: 5 },
      { source: "CHECKIN_DAILY", points: -2 },
      { source: "READING_DURATION", points: 2 },
      { source: "READING_DURATION", points: 1 },
      { source: "MANUAL", points: -1 },
    ]
    const breakdown = scoreBreakdown(events)
    expect(breakdown).toEqual({
      CHECKIN_DAILY: 3,
      READING_DURATION: 3,
      MANUAL: -1,
    })
    expect(
      Object.values(breakdown).reduce((total, points) => total + points, 0),
    ).toBe(events.reduce((total, event) => total + event.points, 0))
  })
})
