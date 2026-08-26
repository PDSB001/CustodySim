import { and, eq } from "drizzle-orm"

import type { CustodyLevel, PrisonerCustodyStatus } from "@/lib/constants"
import { db } from "@/lib/db"
import { persons, rules } from "@/lib/db/schema"

export type CheckinSlotSetting = {
  label: string
  time: string
  timeoutMinutes: number
}

export const CUSTODY_CHECKIN_PRESETS: Record<
  CustodyLevel,
  { name: string; slots: CheckinSlotSetting[] }
> = {
  STRICT: {
    name: "严管 C 级打卡方案",
    slots: [
      { label: "晨起", time: "07:00", timeoutMinutes: 30 },
      { label: "早餐", time: "07:45", timeoutMinutes: 15 },
      { label: "午餐", time: "12:00", timeoutMinutes: 30 },
      { label: "午休", time: "14:00", timeoutMinutes: 15 },
      { label: "晚间点名", time: "19:00", timeoutMinutes: 30 },
      { label: "就寝", time: "21:30", timeoutMinutes: 30 },
    ],
  },
  GENERAL: {
    name: "普管 B 级打卡方案",
    slots: [
      { label: "晨起", time: "07:00", timeoutMinutes: 30 },
      { label: "早间点名", time: "08:00", timeoutMinutes: 15 },
      { label: "晚间点名", time: "19:00", timeoutMinutes: 30 },
      { label: "就寝", time: "21:30", timeoutMinutes: 30 },
    ],
  },
  RELAXED: {
    name: "宽管 A 级打卡方案",
    slots: [
      { label: "晨起", time: "07:00", timeoutMinutes: 60 },
      { label: "晚间点名", time: "19:00", timeoutMinutes: 60 },
      { label: "就寝", time: "21:30", timeoutMinutes: 60 },
    ],
  },
}

export function parseCheckinSlotSettings(value: unknown): CheckinSlotSetting[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is CheckinSlotSetting =>
        typeof item === "object" &&
        item !== null &&
        "label" in item &&
        "time" in item &&
        "timeoutMinutes" in item &&
        typeof item.label === "string" &&
        typeof item.time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) &&
        typeof item.timeoutMinutes === "number" &&
        item.timeoutMinutes > 0,
    )
    .sort((left, right) => left.time.localeCompare(right.time))
}

export async function getCustodyProfileForUser(userId: string) {
  const [profile] = await db
    .select({
      custodyLevel: persons.custodyLevel,
      custodyStatus: persons.custodyStatus,
    })
    .from(persons)
    .where(
      and(eq(persons.userId, userId), eq(persons.personType, "SUPERVISED")),
    )
    .limit(1)
  return profile as
    | { custodyLevel: CustodyLevel; custodyStatus: PrisonerCustodyStatus }
    | undefined
}

export async function isUserInCustody(userId: string) {
  return (
    (await getCustodyProfileForUser(userId))?.custodyStatus === "IN_CUSTODY"
  )
}

export async function ensureCustodyCheckinPresets() {
  const existing = await db
    .select({ custodyLevel: rules.custodyLevel })
    .from(rules)
    .where(and(eq(rules.type, "CHECKIN"), eq(rules.enabled, true)))
  const existingLevels = new Set(existing.map((rule) => rule.custodyLevel))
  const missing = (
    Object.entries(CUSTODY_CHECKIN_PRESETS) as [
      CustodyLevel,
      (typeof CUSTODY_CHECKIN_PRESETS)[CustodyLevel],
    ][]
  ).filter(([level]) => !existingLevels.has(level))
  if (!missing.length) return
  await db.insert(rules).values(
    missing.map(([custodyLevel, preset]) => ({
      name: preset.name,
      type: "CHECKIN",
      taskType: "CHECKIN",
      freq: "DAILY",
      timeSlots: preset.slots.map((slot) => slot.time),
      slotSettings: preset.slots,
      timeoutMinutes: preset.slots[0]?.timeoutMinutes ?? 30,
      custodyLevel,
      enabled: true,
      allowNoLocation: true,
    })),
  )
}
