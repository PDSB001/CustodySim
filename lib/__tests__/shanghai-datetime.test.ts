import { expect, it } from "vitest"
import { ApplicationDraftSchema } from "@/lib/admin-schemas"
import {
  legacyDateAllDay,
  parseIso,
  shanghaiLocalToIso,
} from "@/lib/shanghai-datetime"

it.each(["2026-02-29", "2026-02-30", "2026-04-31"])(
  "不存在的日期 %s 不能被自动归一化后接受",
  (date) => {
    expect(parseIso(`${date}T09:00:00+08:00`)).toBeNull()
    expect(shanghaiLocalToIso(`${date}T09:00`)).toBeNull()
    expect(legacyDateAllDay(date)).toBeNull()
    expect(
      ApplicationDraftSchema.safeParse({
        type: "LEAVE",
        reason: "日期验证",
        leaveStartAt: `${date}T09:00`,
        leaveEndAt: "2026-05-01T09:00",
      }).success,
    ).toBe(false)
  },
)
it("合法闰日和带偏移量的时间保持原有语义", () => {
  expect(parseIso("2028-02-29T09:00:00+08:00")?.toISOString()).toBe(
    "2028-02-29T01:00:00.000Z",
  )
  expect(shanghaiLocalToIso("2028-02-29T09:00")).toBe(
    "2028-02-29T09:00:00+08:00",
  )
  expect(legacyDateAllDay("2028-02-29")).not.toBeNull()
  expect(parseIso("2026-08-31T23:59:59.123Z")?.toISOString()).toBe(
    "2026-08-31T23:59:59.123Z",
  )
})
