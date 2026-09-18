import { NextRequest } from "next/server"
import { and, asc, eq, gte, lte } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { electronicFences } from "@/lib/db/schema"
import { GPS_RETENTION_MS } from "@/lib/privacy-retention"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"

/** 与隐私策略一致：更早的坐标已被清理任务物理删除，查也查不到。 */
const MAX_WINDOW_MS = GPS_RETENTION_MS
const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000
/** 单次返回上限，防止 72 小时窗口下的响应体过大。 */
const MAX_POINTS = 2_000

function parseDate(value: string | null, fallback: Date | null) {
  if (!value) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * 查询某人某段时间的位置轨迹，供移动端/监管端画轨迹图。
 *
 * 数据来源是 `electronic_fences` 的 LOCATION 行 —— 也就是批量上报写入的同一批数据，
 * 保留期由 `ELECTRONIC_FENCE_LOCATION_RETENTION_MS`（72 小时）决定，因此这里把
 * 查询窗口也限制在 72 小时内，避免出现"能查但永远为空"的误导。
 *
 * 权限：仅监管员/管理员，且目标人员需在其监管范围内；不对被监管人开放。
 */
export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)

  // 轨迹仅供监管方查看，不对被监管人开放（产品决定，也避免暴露监控细节）。
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "轨迹仅供监管方查看", 403)

  const params = request.nextUrl.searchParams
  const targetId = params.get("userId")
  if (!targetId)
    return failure("VALIDATION_ERROR", "请指定要查询的人员", 400)
  const scope = [...(await getSupervisedUserIdsForActor(actor))]
  if (!scope.includes(targetId))
    return failure("FORBIDDEN", "该人员不在你的监管范围内", 403)

  const now = new Date()
  const to = parseDate(params.get("to"), now)
  const from = parseDate(
    params.get("from"),
    new Date(now.getTime() - DEFAULT_WINDOW_MS),
  )
  if (!from || !to)
    return failure("VALIDATION_ERROR", "时间范围不合法", 400)
  if (to.getTime() <= from.getTime())
    return failure("VALIDATION_ERROR", "结束时间必须晚于开始时间", 400)
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS)
    return failure(
      "VALIDATION_ERROR",
      "查询区间不能超过 72 小时，更早的坐标已按隐私策略清除",
      400,
    )

  try {
    const rows = await db
      .select({
        reportedAt: electronicFences.reportedAt,
        latitude: electronicFences.latitude,
        longitude: electronicFences.longitude,
        accuracyMeters: electronicFences.accuracyMeters,
        verdict: electronicFences.verdict,
        transition: electronicFences.transition,
      })
      .from(electronicFences)
      .where(
        and(
          eq(electronicFences.entryType, "LOCATION"),
          eq(electronicFences.userId, targetId),
          gte(electronicFences.reportedAt, from),
          lte(electronicFences.reportedAt, to),
        ),
      )
      .orderBy(asc(electronicFences.reportedAt))
      .limit(MAX_POINTS)

    return success({
      userId: targetId,
      from: from.toISOString(),
      to: to.toISOString(),
      retentionHours: Math.round(GPS_RETENTION_MS / 3_600_000),
      truncated: rows.length >= MAX_POINTS,
      points: rows.map((row) => ({
        reportedAt: row.reportedAt,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracyMeters: row.accuracyMeters,
        verdict: row.verdict,
        transition: row.transition,
      })),
    })
  } catch (error) {
    console.error("[API mobile location track]", error)
    return failure("INTERNAL_ERROR", "轨迹查询失败", 500)
  }
}
