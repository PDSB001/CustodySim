export type RuleFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "ONCE"

export type SchedulableRule = {
  freq: RuleFrequency
  scheduleDays: unknown
  startDate: Date | null
  endDate: Date | null
}

export function parseSlots(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (slot): slot is string =>
        typeof slot === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot),
    )
    .sort()
}

export function computeCycle(frequency: RuleFrequency, date = new Date()) {
  const {
    year,
    month: monthNumber,
    day: dayNumber,
    weekday,
  } = getShanghaiCalendarParts(date)
  const month = `${monthNumber}`.padStart(2, "0")
  const day = `${dayNumber}`.padStart(2, "0")
  if (frequency === "DAILY") return `${year}-${month}-${day}`
  if (frequency === "MONTHLY") return `${year}-${month}`
  if (frequency === "ONCE") return "once"
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, dayNumber))
  firstDay.setUTCDate(firstDay.getUTCDate() - ((weekday + 6) % 7))
  return `${firstDay.getUTCFullYear()}-W${`${Math.ceil((firstDay.getUTCDate() + 1) / 7)}`.padStart(2, "0")}`
}

export function computeDeadline(scheduleAt: Date, timeoutMinutes: number) {
  return new Date(scheduleAt.getTime() + timeoutMinutes * 60_000)
}

export function isRuleScheduledForDate(rule: SchedulableRule, date: Date) {
  const dateKey = getShanghaiDateKey(date)
  if (rule.startDate && dateKey < getShanghaiDateKey(rule.startDate))
    return false
  if (rule.endDate && dateKey > getShanghaiDateKey(rule.endDate)) return false
  const { day, weekday } = getShanghaiCalendarParts(date)
  const scheduleDays = Array.isArray(rule.scheduleDays)
    ? rule.scheduleDays.filter((day): day is number => typeof day === "number")
    : []
  if (rule.freq === "WEEKLY")
    return scheduleDays.includes(((weekday + 6) % 7) + 1)
  if (rule.freq === "MONTHLY") return scheduleDays.includes(day)
  if (rule.freq === "ONCE")
    return Boolean(
      rule.startDate && getShanghaiDateKey(rule.startDate) === dateKey,
    )
  return true
}
import {
  getShanghaiCalendarParts,
  getShanghaiDateKey,
} from "@/lib/shanghai-datetime"
