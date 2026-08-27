import { and, eq, lt } from "drizzle-orm"

import { db } from "@/lib/db"
import { checkinRecords, electronicFences } from "@/lib/db/schema"

export const GPS_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
export const ELECTRONIC_FENCE_LOCATION_RETENTION_MS = GPS_RETENTION_MS

export function getGpsExpiry(checkinAt: Date) {
  return new Date(checkinAt.getTime() + GPS_RETENTION_MS)
}

export async function purgeExpiredGpsCheckinData(now = new Date()) {
  const rows = await db
    .select({ id: checkinRecords.id, location: checkinRecords.location })
    .from(checkinRecords)
    .where(
      and(
        eq(checkinRecords.locationSource, "GPS"),
        lt(checkinRecords.gpsExpiresAt, now),
      ),
    )
  for (const row of rows) {
    const previous = (row.location ?? {}) as { ip?: unknown }
    await db
      .update(checkinRecords)
      .set({
        location: {
          source: "GPS_PURGED",
          clearedAt: now.toISOString(),
          ...(previous.ip ? { ip: previous.ip } : {}),
        },
        locationSource: "GPS_PURGED",
        lat: null,
        lng: null,
        gpsExpiresAt: null,
      })
      .where(eq(checkinRecords.id, row.id))
  }
  return rows.length
}

export async function purgeExpiredElectronicFenceLocations(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - ELECTRONIC_FENCE_LOCATION_RETENTION_MS,
  )
  const rows = await db
    .delete(electronicFences)
    .where(
      and(
        eq(electronicFences.entryType, "LOCATION"),
        lt(electronicFences.reportedAt, cutoff),
      ),
    )
    .returning({ id: electronicFences.id })
  return rows.length
}

const schedulerKey = Symbol.for("custodysim.gps-retention-scheduler")

export function startGpsPrivacyRetentionScheduler() {
  const runtime = globalThis as typeof globalThis & {
    [schedulerKey]?: ReturnType<typeof setInterval>
  }
  if (runtime[schedulerKey]) return

  void Promise.all([
    purgeExpiredGpsCheckinData(),
    purgeExpiredElectronicFenceLocations(),
  ]).catch((error: unknown) =>
    console.error("[privacy retention] initial GPS cleanup failed", error),
  )
  const timer = setInterval(
    () =>
      void Promise.all([
        purgeExpiredGpsCheckinData(),
        purgeExpiredElectronicFenceLocations(),
      ]).catch((error: unknown) =>
        console.error(
          "[privacy retention] scheduled GPS cleanup failed",
          error,
        ),
      ),
    60 * 60 * 1000,
  )
  timer.unref?.()
  runtime[schedulerKey] = timer
}
