import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  checkinMakeups,
  checkinRecords,
  checkinTasks,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"

type Actor = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>

/**
 * 每页条数：默认 20 而不是 50。
 *
 * `checkin_records.photo_url` 存的是照片的 **data URL（base64）**，单张上限约 1MB；
 * 一次 50 条就是几十 MB 的响应。默认 20 条已经够看一天半的时段，
 * 需要更多就让调用方显式传 limit（上限 100）。
 * 后续若要进一步降载，可改为"列表只给 hasPhoto 标记 + 点开再取单张"。
 */
export const DEFAULT_RECORD_PAGE_SIZE = 20
export const MAX_RECORD_PAGE_SIZE = 100

/** `checkin_records.status` 的取值全集（见 lib/checkin.ts 的状态定义）。 */
export const CHECKIN_RECORD_STATUSES = [
  "ON_TIME",
  "LATE",
  "MAKEUP",
  "SYSTEM_MAKEUP",
] as const

export type CheckinRecordCursor = { at: Date; id: string }

export type CheckinRecordDetailParams = {
  /** 要查看的被监管人。 */
  userId: string
  /** 打卡时间下界（含）。 */
  from?: Date | null
  /** 打卡时间上界（不含）。 */
  to?: Date | null
  /** 只取这些打卡状态；不传表示全部。 */
  statuses?: readonly string[] | null
  cursor?: CheckinRecordCursor | null
  limit?: number
}

/**
 * 按人读取打卡明细（监管侧）。
 *
 * 与 `/api/supervision/checkins` 的"单日按人汇总"不同，这个查询逐条返回打卡记录本身：
 * 时段、状态、打卡时间、照片、地点、来源、客户端、备注，以及补卡关联与其审批意见。
 *
 * 可见范围与其它监管接口一致（`getSupervisedUserIdsForActor`）：管理员为全部在押人员，
 * 监管员为其辖区，被监管人为本人 —— 传进来的 `userId` 不在范围内就直接返回空，
 * 不区分"不存在"与"不可见"，避免探测他人 id。
 *
 * 游标为 `checkinAt|id` 降序，与项目其它列表接口一致（相同时间戳下按 id 继续翻，不重不漏）。
 */
export async function getCheckinRecordDetail(
  actor: Actor,
  params: CheckinRecordDetailParams,
) {
  const ids = [...(await getSupervisedUserIdsForActor(actor))]
  if (!ids.length || !ids.includes(params.userId)) {
    return { items: [], nextCursor: null as string | null }
  }

  const limit = Math.min(
    Math.max(
      Number.isFinite(params.limit) ? Math.trunc(params.limit as number) : DEFAULT_RECORD_PAGE_SIZE,
      1,
    ),
    MAX_RECORD_PAGE_SIZE,
  )

  const filters = [eq(checkinRecords.userId, params.userId)]
  if (params.from) filters.push(gte(checkinRecords.checkinAt, params.from))
  if (params.to) filters.push(lt(checkinRecords.checkinAt, params.to))
  if (params.statuses?.length) {
    filters.push(inArray(checkinRecords.status, [...params.statuses]))
  }
  if (params.cursor) {
    const cursorCondition = or(
      lt(checkinRecords.checkinAt, params.cursor.at),
      and(
        eq(checkinRecords.checkinAt, params.cursor.at),
        lt(checkinRecords.id, sql`${params.cursor.id}::uuid`),
      ),
    )
    if (cursorCondition) filters.push(cursorCondition)
  }

  const rows = await db
    .select({
      id: checkinRecords.id,
      taskId: checkinRecords.taskId,
      checkinAt: checkinRecords.checkinAt,
      status: checkinRecords.status,
      slotIndex: checkinRecords.slotIndex,
      photoUrl: checkinRecords.photoUrl,
      location: checkinRecords.location,
      lat: checkinRecords.lat,
      lng: checkinRecords.lng,
      locationSource: checkinRecords.locationSource,
      ip: checkinRecords.ip,
      clientType: checkinRecords.clientType,
      browserType: checkinRecords.browserType,
      remark: checkinRecords.remark,
      // 任务侧：时段与计划时间，用来把"几点该打、几点打的"放在一起看
      taskStatus: checkinTasks.status,
      scheduleAt: checkinTasks.scheduleAt,
      deadline: checkinTasks.deadline,
      // 补卡关联（正常打卡这些为 null）
      makeupId: checkinRecords.makeupId,
      makeupReason: checkinMakeups.reason,
      makeupStatus: checkinMakeups.status,
      makeupComment: checkinMakeups.reviewComment,
      makeupReviewedAt: checkinMakeups.reviewedAt,
      makeupPhotoUrl: checkinMakeups.photoUrl,
    })
    .from(checkinRecords)
    .innerJoin(checkinTasks, eq(checkinTasks.id, checkinRecords.taskId))
    .leftJoin(checkinMakeups, eq(checkinMakeups.id, checkinRecords.makeupId))
    .where(and(...filters))
    .orderBy(desc(checkinRecords.checkinAt), desc(checkinRecords.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)

  return {
    items,
    nextCursor:
      hasMore && last ? `${last.checkinAt.toISOString()}|${last.id}` : null,
  }
}

/**
 * 解析明细接口的查询参数。
 *
 * 返回 `null` 表示参数不合法（由调用方给出 400）；`from`/`to` 用宽松解析，
 * 既接受 `2026-09-26` 也接受完整 ISO 时间戳。
 */
export function parseCheckinRecordQuery(searchParams: URLSearchParams) {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const userId = searchParams.get("userId") ?? ""
  if (!UUID_PATTERN.test(userId)) return null

  const parseDate = (value: string | null): Date | null | undefined => {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  const from = parseDate(searchParams.get("from"))
  const to = parseDate(searchParams.get("to"))
  if (from === undefined || to === undefined) return null
  if (from && to && from >= to) return null

  const rawStatus = searchParams.get("status")
  const statuses = rawStatus
    ? rawStatus
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : null
  if (
    statuses &&
    statuses.some(
      (status) => !CHECKIN_RECORD_STATUSES.includes(status as never),
    )
  ) {
    return null
  }

  const rawLimit = Number(searchParams.get("limit"))
  const [cursorTime, cursorId] = (searchParams.get("cursor") ?? "").split("|")
  const cursorDate = cursorTime ? new Date(cursorTime) : null
  const hasCursor =
    cursorDate !== null &&
    !Number.isNaN(cursorDate.getTime()) &&
    UUID_PATTERN.test(cursorId ?? "")

  return {
    userId,
    from,
    to,
    statuses,
    limit: Number.isFinite(rawLimit) ? rawLimit : DEFAULT_RECORD_PAGE_SIZE,
    cursor: hasCursor ? ({ at: cursorDate, id: cursorId } as CheckinRecordCursor) : null,
  }
}
