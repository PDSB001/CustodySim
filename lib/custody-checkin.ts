import { and, desc, eq, inArray } from "drizzle-orm"

import type {
  CustodyCheckinPlanLevel,
  CustodyLevel,
  PrisonerCustodyStatus,
} from "@/lib/constants"
import { isLeaveActive, isTemporaryReleaseActive } from "@/lib/application"
import { db } from "@/lib/db"
import { applications, persons, rules } from "@/lib/db/schema"

export type CheckinSlotSetting = {
  label: string
  time: string
  timeoutMinutes: number
}

export const CUSTODY_CHECKIN_PRESETS: Record<
  CustodyCheckinPlanLevel,
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
  ISOLATION: {
    name: "禁闭加强打卡方案",
    slots: [
      { label: "早起核验", time: "06:30", timeoutMinutes: 10 },
      { label: "晨起", time: "07:00", timeoutMinutes: 10 },
      { label: "早餐", time: "07:45", timeoutMinutes: 10 },
      { label: "午餐", time: "12:00", timeoutMinutes: 15 },
      { label: "午休", time: "14:00", timeoutMinutes: 10 },
      { label: "下午点名", time: "16:00", timeoutMinutes: 10 },
      { label: "晚间点名", time: "19:00", timeoutMinutes: 10 },
      { label: "就寝", time: "21:30", timeoutMinutes: 10 },
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
  if (!profile) return undefined
  const status = await syncScheduledCustodyStatus(
    userId,
    profile.custodyStatus as PrisonerCustodyStatus,
  )
  return {
    custodyLevel: profile.custodyLevel as CustodyLevel,
    custodyStatus: status,
  }
}

export async function syncScheduledCustodyStatus(
  userId: string,
  currentStatus?: PrisonerCustodyStatus,
  now = new Date(),
) {
  let status = currentStatus
  if (!status) {
    const [profile] = await db
      .select({ custodyStatus: persons.custodyStatus })
      .from(persons)
      .where(and(eq(persons.userId, userId), eq(persons.personType, "SUPERVISED")))
      .limit(1)
    if (!profile) return "OUT_OF_CUSTODY" as PrisonerCustodyStatus
    status = profile.custodyStatus as PrisonerCustodyStatus
  }
  if (
    status !== "IN_CUSTODY" &&
    status !== "ON_LEAVE" &&
    status !== "TEMPORARY_OUT_OF_CUSTODY"
  )
    return status
  const approvedAbsences = await db
    .select({ type: applications.type, payload: applications.payload })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applications.type, ["LEAVE", "TEMPORARY_OUT_OF_CUSTODY"]),
        eq(applications.status, "APPROVED"),
      ),
    )
    .orderBy(desc(applications.decidedAt))
  const temporaryReleaseActive = approvedAbsences.some(
    (item) =>
      item.type === "TEMPORARY_OUT_OF_CUSTODY" &&
      isTemporaryReleaseActive(item.payload, now),
  )
  const leaveActive = approvedAbsences.some(
    (item) => item.type === "LEAVE" && isLeaveActive(item.payload, now),
  )
  const nextStatus: PrisonerCustodyStatus = temporaryReleaseActive
    ? "TEMPORARY_OUT_OF_CUSTODY"
    : leaveActive
      ? "ON_LEAVE"
      : status === "TEMPORARY_OUT_OF_CUSTODY" || status === "ON_LEAVE"
        ? "IN_CUSTODY"
        : status
  if (nextStatus !== status)
    await db
      .update(persons)
      .set({ custodyStatus: nextStatus, updatedAt: now })
      .where(eq(persons.userId, userId))
  return nextStatus
}

export const syncTemporaryReleaseCustodyStatus = syncScheduledCustodyStatus

export async function isUserInCustody(userId: string) {
  return ["IN_CUSTODY", "ISOLATION"].includes(
    (await getCustodyProfileForUser(userId))?.custodyStatus ?? "",
  )
}

export async function syncAllScheduledCustodyStatuses(now = new Date()) {
  const profiles = await db
    .select({ userId: persons.userId, custodyStatus: persons.custodyStatus })
    .from(persons)
    .where(
      and(
        eq(persons.personType, "SUPERVISED"),
        inArray(persons.custodyStatus, [
          "IN_CUSTODY",
          "ON_LEAVE",
          "TEMPORARY_OUT_OF_CUSTODY",
        ]),
      ),
    )
  for (const profile of profiles) {
    if (!profile.userId) continue
    await syncScheduledCustodyStatus(
      profile.userId,
      profile.custodyStatus as PrisonerCustodyStatus,
      now,
    )
  }
  return profiles.length
}

const custodyStatusSchedulerKey = Symbol.for(
  "custodysim.scheduled-custody-status-scheduler",
)

export function startScheduledCustodyStatusScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [custodyStatusSchedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[custodyStatusSchedulerKey]) return
  void syncAllScheduledCustodyStatuses().catch((error: unknown) =>
    console.error("[custody status] initial absence-status sync failed", error),
  )
  const timer = setInterval(
    () =>
      void syncAllScheduledCustodyStatuses().catch((error: unknown) =>
        console.error("[custody status] scheduled absence-status sync failed", error),
      ),
    5 * 60 * 1000,
  )
  timer.unref?.()
  runtime[custodyStatusSchedulerKey] = timer
}

export async function ensureCustodyCheckinPresets() {
  const existing = await db
    .select({ custodyLevel: rules.custodyLevel })
    .from(rules)
    .where(and(eq(rules.type, "CHECKIN"), eq(rules.enabled, true)))
  const existingLevels = new Set(existing.map((rule) => rule.custodyLevel))
  const missing = (
    Object.entries(CUSTODY_CHECKIN_PRESETS) as [
      CustodyCheckinPlanLevel,
      (typeof CUSTODY_CHECKIN_PRESETS)[CustodyCheckinPlanLevel],
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
