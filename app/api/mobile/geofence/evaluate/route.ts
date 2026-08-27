import { NextRequest } from "next/server"

import { GeofenceEvaluationSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { getCustodyProfileForUser } from "@/lib/custody-checkin"
import {
  ensureGeofenceExplanationTask,
  getCurrentElectronicFence,
  getLatestElectronicFenceLocation,
  recordElectronicFenceLocation,
} from "@/lib/electronic-fence"
import { evaluateFence, resolveFenceTransition } from "@/lib/geofence"
import { getSessionUser } from "@/lib/session"

const MAX_REPORTED_AGE_MS = 15 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管移动端可上报围栏位置", 403)
  const parsed = GeofenceEvaluationSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "围栏定位数据不合法", 400)
  const now = new Date()
  const capturedAt = new Date(parsed.data.capturedAt)
  const age = now.getTime() - capturedAt.getTime()
  if (age > MAX_REPORTED_AGE_MS || age < -MAX_FUTURE_SKEW_MS)
    return failure("VALIDATION_ERROR", "定位时间无效，请重新采集", 400)

  try {
    const [profile, fence, previousReport] = await Promise.all([
      getCustodyProfileForUser(actor.id),
      getCurrentElectronicFence(actor.id),
      getLatestElectronicFenceLocation(actor.id),
    ])
    const result = evaluateFence({
      fence: fence
        ? {
            id: fence.id,
            name: fence.name,
            latitude: Number(fence.latitude),
            longitude: Number(fence.longitude),
            radiusMeters: fence.radiusMeters,
            coordinateSystem: "GCJ02",
            enabled: fence.enabled,
            boundaryPoints: fence.boundaryPoints ?? [],
          }
        : null,
      point: {
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
      },
      isInCustody: profile?.custodyStatus === "IN_CUSTODY",
    })
    const previousInside =
      previousReport?.insideFence === "INSIDE"
        ? true
        : previousReport?.insideFence === "OUTSIDE"
          ? false
          : null
    const transition = resolveFenceTransition({
      previousInside,
      verdict: result.verdict,
    })
    const report = await recordElectronicFenceLocation({
      userId: actor.id,
      fence,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracyMeters: parsed.data.accuracyMeters,
      reportedAt: capturedAt,
      verdict: result.verdict,
      transition,
    })
    let explanationTaskId: string | null = null
    if (
      (transition === "EXIT" || transition === "INITIAL_OUTSIDE") &&
      fence &&
      result.distanceMeters !== null
    ) {
      const task = await ensureGeofenceExplanationTask({
        userId: actor.id,
        fenceName: fence.name,
        distance: result.distanceMeters,
        radiusMeters: fence.radiusMeters,
        now,
      })
      explanationTaskId = task.taskId
      await writeAuditLog({
        actor,
        action: "CREATE",
        actionLabel: "电子围栏越界",
        entityType: "electronic_fence",
        entityId: fence.id,
        detail: {
          verdict: result.verdict,
          transition,
          distanceMeters: result.distanceMeters,
          accuracyMeters: parsed.data.accuracyMeters,
          explanationTaskId,
        },
      })
    }
    return success({
      verdict: result.verdict,
      transition,
      distanceMeters: result.distanceMeters,
      reportId: report.id,
      fence: fence
        ? {
            id: fence.id,
            name: fence.name,
            radiusMeters: fence.radiusMeters,
            coordinateSystem: "GCJ02",
          }
        : null,
      explanationTaskId,
    })
  } catch (error) {
    console.error("[API geofence evaluate]", error)
    return failure("INTERNAL_ERROR", "围栏判定失败", 500)
  }
}
