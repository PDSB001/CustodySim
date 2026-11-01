import { getShanghaiDateKey } from "@/lib/shanghai-datetime"

export const BALANCED_SCORING_START_DAY = "2026-11-01"
export const LEGACY_SCORE_POLICY = {
  checkinCompleted: 1,
  checkinMakeup: -1,
  checkinMissing: -2,
  checkinDailyMin: null as number | null,
  checkinDailyMax: null as number | null,
  taskFirstPass: 3,
  taskReturnedThenPass: 2,
  taskExpired: -3,
  isolationTaskExpired: -3,
  isolationMinAttendanceRatio: 0.5,
  isolationThreshold: 0,
  isolationDurationDays: 3,
}
export const SCORE_POLICY = {
  ...LEGACY_SCORE_POLICY,
  checkinMakeup: 0,
  checkinMissing: -1,
  checkinDailyMin: -4,
  checkinDailyMax: 4,
  isolationTaskExpired: 0,
}
export function getScorePolicy(dayKey: string) {
  return dayKey < BALANCED_SCORING_START_DAY
    ? LEGACY_SCORE_POLICY
    : SCORE_POLICY
}
export function getTaskExpiredPoints(source: string, scheduleAt: Date) {
  const policy = getScorePolicy(getShanghaiDateKey(scheduleAt))
  return source === "ISOLATION"
    ? policy.isolationTaskExpired
    : policy.taskExpired
}
