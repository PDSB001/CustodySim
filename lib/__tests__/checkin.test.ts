import { describe, expect, it } from "vitest"

import {
  getCheckinTaskStatus,
  getDayRange,
  getRecordStatus,
} from "@/lib/checkin"

describe("checkin timing", () => {
  const scheduleAt = new Date("2026-08-26T06:30:00.000+08:00")
  const deadline = new Date("2026-08-26T07:00:00.000+08:00")

  it("builds a day range from midnight to the following midnight", () => {
    const range = getDayRange(new Date("2026-08-26T18:20:00.000+08:00"))
    expect(range.start).toEqual(new Date("2026-08-26T00:00:00.000+08:00"))
    expect(range.end).toEqual(new Date("2026-08-27T00:00:00.000+08:00"))
  })

  it("moves the day-range end across a month boundary", () => {
    const range = getDayRange(new Date("2026-08-31T23:59:00.000+08:00"))
    expect(range.end).toEqual(new Date("2026-09-01T00:00:00.000+08:00"))
  })

  it("moves the day-range end across a year boundary", () => {
    const range = getDayRange(new Date("2026-12-31T23:59:00.000+08:00"))
    expect(range.end).toEqual(new Date("2027-01-01T00:00:00.000+08:00"))
  })

  it.each([
    ["PENDING", new Date("2026-08-26T06:30:00.000+08:00"), "PENDING"],
    ["PENDING", new Date("2026-08-26T07:00:00.000+08:00"), "PENDING"],
    ["PENDING", new Date("2026-08-26T07:00:00.001+08:00"), "MISSED"],
    ["COMPLETED", new Date("2026-08-26T12:00:00.000+08:00"), "COMPLETED"],
    ["LATE", new Date("2026-08-26T12:00:00.000+08:00"), "LATE"],
    ["MISSED", new Date("2026-08-26T12:00:00.000+08:00"), "MISSED"],
    [
      "MAKEUP_PENDING",
      new Date("2026-08-26T12:00:00.000+08:00"),
      "MAKEUP_PENDING",
    ],
    [
      "MAKEUP_APPROVED",
      new Date("2026-08-26T12:00:00.000+08:00"),
      "MAKEUP_APPROVED",
    ],
    [
      "MAKEUP_REJECTED",
      new Date("2026-08-26T12:00:00.000+08:00"),
      "MAKEUP_REJECTED",
    ],
    [
      "SYSTEM_MAKEUP",
      new Date("2026-08-26T12:00:00.000+08:00"),
      "SYSTEM_MAKEUP",
    ],
  ] as const)(
    "maps %s status at the correct moment",
    (status, now, expected) => {
      expect(getCheckinTaskStatus(status, deadline, now)).toBe(expected)
    },
  )

  it.each([
    [new Date("2026-08-26T06:30:00.000+08:00"), "ON_TIME"],
    [new Date("2026-08-26T06:45:00.000+08:00"), "ON_TIME"],
    [new Date("2026-08-26T07:00:00.000+08:00"), "ON_TIME"],
    [new Date("2026-08-26T07:00:00.001+08:00"), "LATE"],
    [new Date("2026-08-26T09:30:00.000+08:00"), "LATE"],
  ] as const)("marks check-in at %s as %s", (now, expected) => {
    expect(getRecordStatus(scheduleAt, deadline, now)).toBe(expected)
  })

  it.each([
    new Date("2026-08-26T00:00:00.000+08:00"),
    new Date("2026-08-26T06:29:59.000+08:00"),
  ])("rejects a check-in before the scheduled time", (now) => {
    expect(() => getRecordStatus(scheduleAt, deadline, now)).toThrow(
      "尚未到打卡时间",
    )
  })

  it("does not mutate the scheduled time while evaluating", () => {
    const original = scheduleAt.getTime()
    getRecordStatus(
      scheduleAt,
      deadline,
      new Date("2026-08-26T06:40:00.000+08:00"),
    )
    expect(scheduleAt.getTime()).toBe(original)
  })
})
