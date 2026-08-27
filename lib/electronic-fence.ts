import { and, desc, eq, isNull } from "drizzle-orm"

import { getShanghaiDateKey } from "@/lib/application"
import { db } from "@/lib/db"
import { electronicFences, reportTasks } from "@/lib/db/schema"
import { ensureElectronicFenceReportTemplate } from "@/lib/electronic-fence-report-template"
import { getSupervisorIdsForSupervised } from "@/lib/supervision-scope"

export async function getCurrentElectronicFence(userId?: string) {
  if (userId) {
    const [personalFence] = await db
      .select()
      .from(electronicFences)
      .where(
        and(
          eq(electronicFences.entryType, "CONFIG"),
          eq(electronicFences.userId, userId),
        ),
      )
      .orderBy(desc(electronicFences.updatedAt))
      .limit(1)
    // 人员专属配置即使是“停用”，也应覆盖默认围栏。
    if (personalFence) return personalFence.enabled ? personalFence : null
  }

  const [fence] = await db
    .select()
    .from(electronicFences)
    .where(
      and(
        eq(electronicFences.entryType, "CONFIG"),
        isNull(electronicFences.userId),
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
    .returning({
      id: electronicFences.id,
      reportedAt: electronicFences.reportedAt,
    })
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

  const [supervisors, template] = await Promise.all([
    getSupervisorIdsForSupervised(userId),
    ensureElectronicFenceReportTemplate(),
  ])
  const [task] = await db
    .insert(reportTasks)
    .values({
      title,
      supervisedId: userId,
      supervisorId: [...supervisors].sort()[0] ?? null,
      templateId: template.id,
      templateSnapshot: {
        name: template.name,
        kind: template.kind,
        content: template.content,
        fields: template.fields,
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
