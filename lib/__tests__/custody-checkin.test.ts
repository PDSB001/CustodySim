import { describe, expect, it } from "vitest"

import {
  CUSTODY_CHECKIN_PRESETS,
  parseCheckinSlotSettings,
} from "@/lib/custody-checkin"

describe("分级打卡预置方案", () => {
  it("严格执行 C 方案的六个时段及不同有效时长", () => {
    expect(CUSTODY_CHECKIN_PRESETS.STRICT.slots).toEqual([
      { label: "晨起", time: "07:00", timeoutMinutes: 30 },
      { label: "早餐", time: "07:45", timeoutMinutes: 15 },
      { label: "午餐", time: "12:00", timeoutMinutes: 30 },
      { label: "午休", time: "14:00", timeoutMinutes: 15 },
      { label: "晚间点名", time: "19:00", timeoutMinutes: 30 },
      { label: "就寝", time: "21:30", timeoutMinutes: 30 },
    ])
  })

  it("普管采用 B 方案，宽管采用 A 方案", () => {
    expect(CUSTODY_CHECKIN_PRESETS.GENERAL.slots).toHaveLength(4)
    expect(CUSTODY_CHECKIN_PRESETS.GENERAL.slots.at(-1)).toMatchObject({
      time: "21:30",
      timeoutMinutes: 30,
    })
    expect(CUSTODY_CHECKIN_PRESETS.RELAXED.slots).toHaveLength(3)
    expect(CUSTODY_CHECKIN_PRESETS.RELAXED.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ time: "07:00", timeoutMinutes: 60 }),
        expect.objectContaining({ time: "19:00", timeoutMinutes: 60 }),
        expect.objectContaining({ time: "21:30", timeoutMinutes: 60 }),
      ]),
    )
  })

  it("只接收有效时段，并按时间排序", () => {
    expect(
      parseCheckinSlotSettings([
        { label: "晚间", time: "19:00", timeoutMinutes: 30 },
        { label: "无效", time: "25:00", timeoutMinutes: 30 },
        { label: "晨起", time: "07:00", timeoutMinutes: 30 },
      ]),
    ).toEqual([
      { label: "晨起", time: "07:00", timeoutMinutes: 30 },
      { label: "晚间", time: "19:00", timeoutMinutes: 30 },
    ])
  })
})
