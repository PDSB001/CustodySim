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
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  if (frequency === "DAILY") return `${year}-${month}-${day}`
  if (frequency === "MONTHLY") return `${year}-${month}`
  if (frequency === "ONCE") return "once"
  const firstDay = new Date(date)
  const offset = (firstDay.getDay() + 6) % 7
  firstDay.setDate(firstDay.getDate() - offset)
  return `${firstDay.getFullYear()}-W${`${Math.ceil((firstDay.getDate() + 1) / 7)}`.padStart(2, "0")}`
}

export function computeDeadline(scheduleAt: Date, timeoutMinutes: number) {
  return new Date(scheduleAt.getTime() + timeoutMinutes * 60_000)
}

export function isRuleScheduledForDate(rule: SchedulableRule, date: Date) {
  if (rule.startDate && date < new Date(rule.startDate.toDateString()))
    return false
  if (rule.endDate && date > new Date(rule.endDate.toDateString())) return false
  const scheduleDays = Array.isArray(rule.scheduleDays)
    ? rule.scheduleDays.filter((day): day is number => typeof day === "number")
    : []
  if (rule.freq === "WEEKLY")
    return scheduleDays.includes(((date.getDay() + 6) % 7) + 1)
  if (rule.freq === "MONTHLY") return scheduleDays.includes(date.getDate())
  if (rule.freq === "ONCE")
    return Boolean(
      rule.startDate && rule.startDate.toDateString() === date.toDateString(),
    )
  return true
}
