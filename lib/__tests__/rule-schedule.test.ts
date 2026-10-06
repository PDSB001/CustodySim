import { describe, expect, it } from "vitest"

import { isRuleScheduledForDate } from "@/lib/rule-cycle"

describe("rule schedule", () => {
  it("runs a daily rule inside its effective range", () => {
    expect(
      isRuleScheduledForDate(
        {
          freq: "DAILY",
          scheduleDays: [],
          startDate: new Date("2026-08-01T00:00:00.000+08:00"),
          endDate: new Date("2026-08-31T00:00:00.000+08:00"),
        },
        new Date("2026-08-25T00:00:00.000+08:00"),
      ),
    ).toBe(true)
    expect(
      isRuleScheduledForDate(
        {
          freq: "DAILY",
          scheduleDays: [],
          startDate: new Date("2026-08-26T00:00:00.000+08:00"),
          endDate: null,
        },
        new Date("2026-08-25T00:00:00.000+08:00"),
      ),
    ).toBe(false)
  })

  it("runs weekly rules only on selected weekdays", () => {
    const monday = new Date("2026-08-24T00:00:00.000+08:00")
    const tuesday = new Date("2026-08-25T00:00:00.000+08:00")
    const rule = {
      freq: "WEEKLY" as const,
      scheduleDays: [1, 3],
      startDate: null,
      endDate: null,
    }
    expect(isRuleScheduledForDate(rule, monday)).toBe(true)
    expect(isRuleScheduledForDate(rule, tuesday)).toBe(false)
  })

  it("runs monthly rules only on selected dates", () => {
    const rule = {
      freq: "MONTHLY" as const,
      scheduleDays: [1, 15],
      startDate: null,
      endDate: null,
    }
    expect(
      isRuleScheduledForDate(rule, new Date("2026-08-15T00:00:00.000+08:00")),
    ).toBe(true)
    expect(
      isRuleScheduledForDate(rule, new Date("2026-08-16T00:00:00.000+08:00")),
    ).toBe(false)
  })

  it("runs one-time rules on their start date only", () => {
    const rule = {
      freq: "ONCE" as const,
      scheduleDays: [],
      startDate: new Date("2026-08-25T09:00:00.000+08:00"),
      endDate: null,
    }
    expect(
      isRuleScheduledForDate(rule, new Date("2026-08-25T20:00:00.000+08:00")),
    ).toBe(true)
    expect(
      isRuleScheduledForDate(rule, new Date("2026-08-26T00:00:00.000+08:00")),
    ).toBe(false)
  })

  it("uses Shanghai calendar dates at the UTC day boundary", () => {
    const rule = {
      freq: "WEEKLY" as const,
      scheduleDays: [2],
      startDate: null,
      endDate: null,
    }
    expect(
      isRuleScheduledForDate(rule, new Date("2026-08-24T16:30:00.000Z")),
    ).toBe(true)
  })
})
