import { and, desc, eq } from "drizzle-orm"

import { getShanghaiDateKey } from "@/lib/application"
import { db } from "@/lib/db"
import { electronicFences, reportTasks } from "@/lib/db/schema"
import { getSupervisorIdsForSupervised } from "@/lib/supervision-scope"

export async function getCurrentElectronicFence() {
  const [fence] = await db
    .select()
    .from(electronicFences)
    .where(
      and(
        eq(electronicFences.entryType, "CONFIG"),
        eq(electronicFences.enabled, true),
      ),
    )
    .orderBy(desc(electronicFences.updatedAt))
    .limit(1)
  return fence ?? null
}

export async function getLatestElectronicFenceLocation(userId: string) {
  const [report] = await db
    .select({
      id: electronicFences.id,
      insideFence: electronicFences.verdict,
      reportedAt: electronicFences.reportedAt,
      transition: electronicFences.transition,
    })
    .from(electronicFences)
    .where(
      and(
        eq(electronicFences.entryType, "LOCATION"),
        eq(electronicFences.userId, userId),
      ),
    )
    .orderBy(desc(electronicFences.reportedAt))
    .limit(1)
  return report ?? null
}

export async function recordElectronicFenceLocation({
  userId,
  fence,
  latitude,
  longitude,
  accuracyMeters,
  reportedAt,
  verdict,
  transition,
}: {
  userId: string
  fence: Awaited<ReturnType<typeof getCurrentElectronicFence>>
  latitude: number
  longitude: number
  accuracyMeters: number
  reportedAt: Date
  verdict: string
  transition: string
}) {
  const [report] = await db
    .insert(electronicFences)
    .values({
      entryType: "LOCATION",
      name: "移动端定位上报",
      latitude: String(latitude),
      longitude: String(longitude),
      radiusMeters: fence?.radiusMeters ?? 0,
      coordinateSystem: "GCJ02",
      enabled: true,
      userId,
      fenceId: fence?.id ?? null,
      reportedAt,
      accuracyMeters: Math.round(accuracyMeters),
      verdict,
      transition,
    })
    .returning({ id: electronicFences.id, reportedAt: electronicFences.reportedAt })
  if (!report) throw new Error("记录移动端定位失败")
  return report
}

function dateKey(now: Date) {
  return getShanghaiDateKey(now)
}

export async function ensureGeofenceExplanationTask({
  userId,
  fenceName,
  distance,
  radiusMeters,
  now = new Date(),
}: {
  userId: string
  fenceName: string
  distance: number
  radiusMeters: number
  now?: Date
}) {
  const title = `电子围栏越界说明 · ${dateKey(now)}`
  const [existing] = await db
    .select({ id: reportTasks.id })
    .from(reportTasks)
    .where(
      and(
        eq(reportTasks.supervisedId, userId),
        eq(reportTasks.source, "GEOFENCE"),
        eq(reportTasks.title, title),
      ),
    )
    .limit(1)
  if (existing) return { taskId: existing.id, created: false }

  const supervisors = await getSupervisorIdsForSupervised(userId)
  const [task] = await db
    .insert(reportTasks)
    .values({
      title,
      supervisedId: userId,
      supervisorId: [...supervisors].sort()[0] ?? null,
      templateSnapshot: {
        name: "电子围栏越界说明",
        kind: "REPORT",
        content: `系统判定已超出“${fenceName}”电子围栏。请如实说明原因并提交审核。`,
        fields: [
          { name: "越界原因", type: "TEXTAREA", required: true, options: [] },
          { name: "预计返回时间", type: "DATE", required: false, options: [] },
        ],
      },
      payload: { fenceName, distanceMeters: distance, radiusMeters },
      source: "GEOFENCE",
      scheduleAt: now,
      deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    })
    .returning({ id: reportTasks.id })
  if (!task) throw new Error("创建越界说明任务失败")
  return { taskId: task.id, created: true }
}
