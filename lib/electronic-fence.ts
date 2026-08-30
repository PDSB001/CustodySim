import { and, desc, eq, isNull } from "drizzle-orm"

import { getShanghaiDateKey } from "@/lib/application"
import { db } from "@/lib/db"
import { electronicFences, reportTasks } from "@/lib/db/schema"
import { ensureElectronicFenceReportTemplate } from "@/lib/electronic-fence-report-template"
import { getSupervisorIdsForSupervised } from "@/lib/supervision-scope"

export async function getCurrentElectronicFence(
  userId?: string,
  executor: Pick<typeof db, "select"> = db,
) {
  if (userId) {
    const [personalFence] = await executor
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

  const [fence] = await executor
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

export async function getLatestElectronicFenceLocation(
  userId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  const [report] = await executor
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
  executor = db,
}: {
  userId: string
  fence: Awaited<ReturnType<typeof getCurrentElectronicFence>>
  latitude: number
  longitude: number
  accuracyMeters: number
  reportedAt: Date
  verdict: string
  transition: string
  executor?: Pick<typeof db, "insert">
}) {
  const [report] = await executor
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
  executor = db,
}: {
  userId: string
  fenceName: string
  distance: number
  radiusMeters: number
  now?: Date
  executor?: Pick<typeof db, "select" | "insert">
}) {
  const title = `电子围栏越界说明 · ${dateKey(now)}`
  const [existing] = await executor
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
  const [task] = await executor
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
