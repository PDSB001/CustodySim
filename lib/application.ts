import {
  getShanghaiDateKey,
  legacyDateAllDay,
  parseIso,
  resolvePeriod,
} from "@/lib/shanghai-datetime"

export { getShanghaiDateKey }

export const APPLICATION_TYPES = [
  "LEAVE",
  "TEMPORARY_OUT_OF_CUSTODY",
  "SENTENCE_REDUCTION",
  "GENERAL",
] as const
export type ApplicationType = (typeof APPLICATION_TYPES)[number]
export type ApplicationReviewResult = "APPROVED" | "RETURNED" | "REJECTED"

export const APPLICATION_TYPE_LABELS: Record<ApplicationType, string> = {
  LEAVE: "请假申请",
  TEMPORARY_OUT_OF_CUSTODY: "临时离监申请",
  SENTENCE_REDUCTION: "减刑申请",
  GENERAL: "一般事项申请",
}

/**
 * 新版 payload 字段语义：
 * - `*StartAt` / `*EndAt`：ISO 字符串（带 +08:00 时区），精确到分钟
 * - `*StartDate` / `*EndDate`：YYYY-MM-DD 字符串（历史数据），按"整天"解读
 */
type TemporaryReleasePayload = {
  temporaryReleaseStartAt?: unknown
  temporaryReleaseEndAt?: unknown
  temporaryReleaseStartDate?: unknown
  temporaryReleaseEndDate?: unknown
}

type LeavePayload = {
  leaveStartAt?: unknown
  leaveEndAt?: unknown
  leaveStartDate?: unknown
  leaveEndDate?: unknown
}

/** 判断 payload 是否携带合法的"起止时刻对"。 */
function hasValidPeriod(
  payload: Record<string, unknown>,
  startKey: string,
  endKey: string,
  legacyStartKey: string,
  legacyEndKey: string,
) {
  const newStart = payload[startKey]
  const newEnd = payload[endKey]
  if (typeof newStart === "string" && typeof newEnd === "string") {
    if (parseIso(newStart) && parseIso(newEnd)) return true
  }
  return !!legacyDateAllDay(payload[legacyStartKey] as string | null | undefined)
    && !!legacyDateAllDay(payload[legacyEndKey] as string | null | undefined)
}

/**
 * 判断当前时刻是否落在临时离监的批准区间内。
 * 优先 `temporaryReleaseStartAt`/`temporaryReleaseEndAt`（带时区 ISO 字符串），
 * 缺失时 fallback 到老的 `temporaryReleaseStartDate`/`temporaryReleaseEndDate`（整天有效）。
 */
export function isTemporaryReleaseActive(
  payload: unknown,
  now: Date = new Date(),
): boolean {
  if (!payload || typeof payload !== "object") return false
  const value = payload as TemporaryReleasePayload
  const period = resolvePeriod(
    value as Record<string, unknown>,
    "temporaryReleaseStartAt",
    "temporaryReleaseEndAt",
    "temporaryReleaseStartDate",
    "temporaryReleaseEndDate",
  )
  if (!period) return false
  const ms = now.getTime()
  return period.startMs <= ms && ms < period.endMs
}

/**
 * 判断当前时刻是否落在请假批准区间内。语义同 isTemporaryReleaseActive。
 */
export function isLeaveActive(
  payload: unknown,
  now: Date = new Date(),
): boolean {
  if (!payload || typeof payload !== "object") return false
  const value = payload as LeavePayload
  const period = resolvePeriod(
    value as Record<string, unknown>,
    "leaveStartAt",
    "leaveEndAt",
    "leaveStartDate",
    "leaveEndDate",
  )
  if (!period) return false
  const ms = now.getTime()
  return period.startMs <= ms && ms < period.endMs
}

/**
 * 把 payload 解析为"起止时刻对"对外暴露，供详情/审核等场景展示。
 * 返回 ISO 字符串对（带时区），找不到则返回 null。
 */
export function readleavePeriod(payload: Record<string, unknown> | null | undefined): {
  startAt: string
  endAt: string
} | null {
  const period = resolvePeriod(
    payload ?? {},
    "leaveStartAt",
    "leaveEndAt",
    "leaveStartDate",
    "leaveEndDate",
  )
  if (!period) return null
  return {
    startAt: new Date(period.startMs).toISOString(),
    endAt: new Date(period.endMs).toISOString(),
  }
}

export function readTemporaryReleasePeriod(
  payload: Record<string, unknown> | null | undefined,
): { startAt: string; endAt: string } | null {
  const period = resolvePeriod(
    payload ?? {},
    "temporaryReleaseStartAt",
    "temporaryReleaseEndAt",
    "temporaryReleaseStartDate",
    "temporaryReleaseEndDate",
  )
  if (!period) return null
  return {
    startAt: new Date(period.startMs).toISOString(),
    endAt: new Date(period.endMs).toISOString(),
  }
}

/**
 * 暴露给 admin-schemas 用：校验 LEAVE/TEMPORARY_OUT_OF_CUSTODY 必须同时提供新或老字段。
 */
export { hasValidPeriod }

export function isApplicationEditable(status: string) {
  return status === "DRAFT" || status === "RETURNED"
}

export function buildApplicationReviewerIds({
  supervisorIds,
  adminId,
}: {
  supervisorIds: string[]
  adminId: string
}) {
  return [
    ...new Set([...supervisorIds].sort().filter((id) => id !== adminId)),
    adminId,
  ]
}

export function resolveApplicationReviewTransition({
  result,
  hasNextReviewer,
  applicationType,
}: {
  result: ApplicationReviewResult
  hasNextReviewer: boolean
  applicationType: ApplicationType
}) {
  if (result === "RETURNED")
    return { applicationStatus: "RETURNED" as const, activateNextReview: false }
  if (result === "REJECTED")
    return { applicationStatus: "REJECTED" as const, activateNextReview: false }
  if (hasNextReviewer)
    return {
      applicationStatus: "PENDING_REVIEW" as const,
      activateNextReview: true,
    }
  return {
    applicationStatus: "APPROVED" as const,
    activateNextReview: false,
    custodyStatus: applicationType === "LEAVE" ? ("ON_LEAVE" as const) : null,
  }
}