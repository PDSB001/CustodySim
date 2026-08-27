/**
 * 上海时区（+08:00）下"时刻"的解析、转换与展示工具。
 *
 * 业务背景：项目统一使用 Asia/Shanghai 时区。
 * - 私有日期时间控件返回的字符串不带时区（如 "2026-08-27T09:00"），
 *   视为上海本地时间，转换为带 +08:00 后缀的 ISO 8601 入库。
 * - 数据库里 `applications.payload.leaveStartAt` 等字段统一存 ISO 字符串。
 * - 老 payload 用 YYYY-MM-DD 日期字符串，fallback 时按"整天 00:00 → 次日 00:00"解读。
 */

export const SHANGHAI_TZ = "Asia/Shanghai"

/**
 * 取上海时区下的日期键 YYYY-MM-DD。
 * 主要用于电子围栏等"按日判断"的场景。
 */
export function getShanghaiDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}

/**
 * 私有日期时间控件字符串（YYYY-MM-DDTHH:mm[:ss]，无时区），
 * 视为上海本地时间，输出带 +08:00 后缀的 ISO 8601。
 * 解析失败返回 null。
 */
export function shanghaiLocalToIso(local: string | null | undefined): string | null {
  if (typeof local !== "string") return null
  const match = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const [, date, time, seconds] = match
  return `${date}T${time}:${seconds ?? "00"}+08:00`
}

/**
 * 解析带时区的 ISO 字符串为 Date 对象。
 * - 必须显式带时区（+08:00、Z 或其它 IANA 偏移），避免本地时区歧义。
 * - 解析失败返回 null。
 */
export function parseIso(iso: string | null | undefined): Date | null {
  if (typeof iso !== "string") return null
  // 必须包含时区标识
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 把 ISO 字符串按上海时区格式化为"MM-DD HH:mm"。
 * - 输入为 null/空/非法时返回 fallback（默认 "—"）。
 */
export function formatIso(
  iso: string | null | undefined,
  fallback = "—",
  options: Intl.DateTimeFormatOptions = {
    timeZone: SHANGHAI_TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
): string {
  const d = parseIso(iso)
  if (!d) return fallback
  return new Intl.DateTimeFormat("zh-CN", options).format(d)
}

/**
 * 把老 payload 的日期字符串 YYYY-MM-DD 解读为 [start, end] 整天范围：
 * - start = 当日 00:00:00+08:00
 * - end = 次日 00:00:00+08:00（左闭右开，覆盖整天 24 小时）
 */
export function legacyDateAllDay(
  date: string | null | undefined,
): { startMs: number; endMs: number } | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const start = new Date(`${date}T00:00:00+08:00`)
  if (Number.isNaN(start.getTime())) return null
  return { startMs: start.getTime(), endMs: start.getTime() + 24 * 60 * 60 * 1000 }
}

/**
 * 把老 payload 的双日期 [startDate, endDate] 都解读为整天范围。
 * 区间 = [startDate 当天 00:00, endDate 次日 00:00)（含头含尾整天）。
 */
export function legacyDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): { startMs: number; endMs: number } | null {
  const start = legacyDateAllDay(startDate)
  if (!start) return null
  // endDate 当天 24:00 = endDate 次日 00:00
  const endStart = legacyDateAllDay(endDate)
  if (!endStart) return null
  return { startMs: start.startMs, endMs: endStart.endMs }
}

/**
 * 从 payload 中读取"起止时刻对"，优先新字段（ISO 字符串），
 * 缺失时 fallback 到老字段（YYYY-MM-DD 解读为整天范围）。
 * 返回毫秒时间戳区间或 null。
 */
export function resolvePeriod(
  payload: Record<string, unknown>,
  startKey: string,
  endKey: string,
  legacyStartKey: string,
  legacyEndKey: string,
): { startMs: number; endMs: number } | null {
  const startIso = payload[startKey]
  const endIso = payload[endKey]
  if (typeof startIso === "string" && typeof endIso === "string") {
    const s = parseIso(startIso)
    const e = parseIso(endIso)
    if (s && e) return { startMs: s.getTime(), endMs: e.getTime() }
  }
  return legacyDateRange(
    payload[legacyStartKey] as string | null | undefined,
    payload[legacyEndKey] as string | null | undefined,
  )
}
