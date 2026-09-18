import { NextRequest } from "next/server"
import { and, eq, gte, sql } from "drizzle-orm"

import { GeofenceBatchSchema } from "@/lib/admin-schemas"
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
import {
  LOCATION_MAX_FUTURE_SKEW_MS,
  LOCATION_MAX_POINTS_PER_DAY,
  LOCATION_MAX_REPORT_AGE_MS,
} from "@/lib/location-reporting"
import { getSessionUser } from "@/lib/session"
import { db } from "@/lib/db"
import { electronicFences } from "@/lib/db/schema"

/**
 * 移动端批量上报位置轨迹。
 *
 * 与单次上报共用同一套判定链路（`evaluateFence` + `resolveFenceTransition` +
 * `recordElectronicFenceLocation`），差别只在于：
 * - 一次处理多个点，按采集时间升序，共用一个事务与一把 advisory lock
 * - 时间不新于已有记录的点**跳过而不报错**（设备重试、重复提交是常态）
 * - 同一批里跨出边界只建一次任务（建任务本身按天幂等）
 *
 * 落库仍是 `electronic_fences` 的 LOCATION 行，因此直接复用现有的
 * `(userId, reportedAt)` 索引与 72 小时清理，无需新增表或迁移。
 */
export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管移动端可上报位置轨迹", 403)
  const parsed = GeofenceBatchSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "轨迹数据不合法", 400)

  const now = new Date()
  const points = [...parsed.data.points].sort(
    (left, right) =>
      new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime(),
  )
  for (const point of points) {
    const age = now.getTime() - new Date(point.capturedAt).getTime()
    if (
      age > LOCATION_MAX_REPORT_AGE_MS ||
      age < -LOCATION_MAX_FUTURE_SKEW_MS
    )
      return failure("VALIDATION_ERROR", "定位时间无效，请重新采集", 400)
  }

  try {
    const summary = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`geofence:${actor.id}`}))`,
      )
      // 每日点数上限：与最小间隔配套 —— 遵守最小间隔的客户端永远碰不到它，
      // 只有异常高频或伪造流量的客户端会被拦下。
      const [counted] = await tx
        .select({ used: sql<number>`count(*)::int` })
        .from(electronicFences)
        .where(
          and(
            eq(electronicFences.entryType, "LOCATION"),
            eq(electronicFences.userId, actor.id),
            gte(
              electronicFences.reportedAt,
              new Date(now.getTime() - 24 * 60 * 60 * 1000),
            ),
          ),
        )
      if ((counted?.used ?? 0) + points.length > LOCATION_MAX_POINTS_PER_DAY)
        return { ok: false as const }

      const profile = await getCustodyProfileForUser(actor.id)
      const isInCustody = ["IN_CUSTODY", "ISOLATION"].includes(
        profile?.custodyStatus ?? "",
      )
      const fence = await getCurrentElectronicFence(actor.id, tx)
      const latest = await getLatestElectronicFenceLocation(actor.id, tx)

      let previousAt = latest?.reportedAt ?? null
      let previousVerdict: string | null = latest?.insideFence ?? null
      let accepted = 0
      let skipped = 0
      let crossings = 0
      let last: { reportedAt: Date; verdict: string; transition: string } | null =
        null

      for (const point of points) {
        const capturedAt = new Date(point.capturedAt)
        if (previousAt && capturedAt <= previousAt) {
          skipped += 1
          continue
        }
        const evaluated = evaluateFence({
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
          point: { latitude: point.latitude, longitude: point.longitude },
          isInCustody,
        })
        const transition = resolveFenceTransition({
          previousInside:
            previousVerdict === "INSIDE"
              ? true
              : previousVerdict === "OUTSIDE"
                ? false
                : null,
          verdict: evaluated.verdict,
        })
        await recordElectronicFenceLocation({
          userId: actor.id,
          fence,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracyMeters: point.accuracyMeters,
          reportedAt: capturedAt,
          verdict: evaluated.verdict,
          transition,
          executor: tx,
        })
        accepted += 1
        previousAt = capturedAt
        previousVerdict = evaluated.verdict
        last = { reportedAt: capturedAt, verdict: evaluated.verdict, transition }

        if (
          (transition === "EXIT" || transition === "INITIAL_OUTSIDE") &&
          fence &&
          evaluated.distanceMeters !== null
        ) {
          const task = await ensureGeofenceExplanationTask({
            userId: actor.id,
            fenceName: fence.name,
            distance: evaluated.distanceMeters,
            radiusMeters: fence.radiusMeters,
            now,
            executor: tx,
          })
          crossings += 1
          await writeAuditLog(
            {
              actor,
              action: "CREATE",
              actionLabel: "电子围栏越界",
              entityType: "electronic_fence",
              entityId: fence.id,
              detail: {
                verdict: evaluated.verdict,
                transition,
                distanceMeters: evaluated.distanceMeters,
                accuracyMeters: point.accuracyMeters,
                explanationTaskId: task.taskId,
                source: "BATCH",
              },
            },
            tx,
          )
        }
      }

      return { ok: true as const, accepted, skipped, crossings, last }
    })
    if (!summary.ok)
      return failure(
        "RATE_LIMITED",
        "近 24 小时位置点数已达上限，请降低上报频率",
        429,
      )
    return success(
      {
        accepted: summary.accepted,
        skipped: summary.skipped,
        crossings: summary.crossings,
        last: summary.last,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("[API mobile location batch]", error)
    return failure("INTERNAL_ERROR", "轨迹上报失败", 500)
  }
}
