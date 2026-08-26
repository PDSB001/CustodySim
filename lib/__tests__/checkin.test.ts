import { describe, expect, it } from "vitest"

import {
  getCheckinTaskStatus,
  getDayRange,
  getRecordStatus,
} from "@/lib/checkin"

describe("checkin timing", () => {
  const scheduleAt = new Date(2026, 7, 26, 6, 30)
  const deadline = new Date(2026, 7, 26, 7, 0)

  it("builds a day range from midnight to the following midnight", () => {
    const range = getDayRange(new Date(2026, 7, 26, 18, 20))
    expect(range.start).toEqual(new Date(2026, 7, 26, 0, 0, 0, 0))
    expect(range.end).toEqual(new Date(2026, 7, 27, 0, 0, 0, 0))
  })

  it("moves the day-range end across a month boundary", () => {
    const range = getDayRange(new Date(2026, 7, 31, 23, 59))
    expect(range.end).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0))
  })

  it("moves the day-range end across a year boundary", () => {
    const range = getDayRange(new Date(2026, 11, 31, 23, 59))
    expect(range.end).toEqual(new Date(2027, 0, 1, 0, 0, 0, 0))
  })

  it.each([
    ["PENDING", new Date(2026, 7, 26, 6, 30), "PENDING"],
    ["PENDING", new Date(2026, 7, 26, 7, 0), "PENDING"],
    ["PENDING", new Date(2026, 7, 26, 7, 0, 0, 1), "MISSED"],
    ["COMPLETED", new Date(2026, 7, 26, 12), "COMPLETED"],
    ["LATE", new Date(2026, 7, 26, 12), "LATE"],
    ["MISSED", new Date(2026, 7, 26, 12), "MISSED"],
    ["MAKEUP_PENDING", new Date(2026, 7, 26, 12), "MAKEUP_PENDING"],
    ["MAKEUP_APPROVED", new Date(2026, 7, 26, 12), "MAKEUP_APPROVED"],
    ["MAKEUP_REJECTED", new Date(2026, 7, 26, 12), "MAKEUP_REJECTED"],
  ] as const)(
    "maps %s status at the correct moment",
    (status, now, expected) => {
      expect(getCheckinTaskStatus(status, deadline, now)).toBe(expected)
    },
  )

  it.each([
    [new Date(2026, 7, 26, 6, 30), "ON_TIME"],
    [new Date(2026, 7, 26, 6, 45), "ON_TIME"],
    [new Date(2026, 7, 26, 7, 0), "ON_TIME"],
    [new Date(2026, 7, 26, 7, 0, 0, 1), "LATE"],
    [new Date(2026, 7, 26, 9, 30), "LATE"],
  ] as const)("marks check-in at %s as %s", (now, expected) => {
    expect(getRecordStatus(scheduleAt, deadline, now)).toBe(expected)
  })

  it.each([new Date(2026, 7, 26, 0), new Date(2026, 7, 26, 6, 29, 59)])(
    "rejects a check-in before the scheduled time",
    (now) => {
      expect(() => getRecordStatus(scheduleAt, deadline, now)).toThrow(
        "尚未到打卡时间",
      )
    },
  )

  it("does not mutate the scheduled time while evaluating", () => {
    const original = scheduleAt.getTime()
    getRecordStatus(scheduleAt, deadline, new Date(2026, 7, 26, 6, 40))
    expect(scheduleAt.getTime()).toBe(original)
  })
})
