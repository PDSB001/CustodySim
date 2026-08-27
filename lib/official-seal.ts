export const OFFICIAL_SEAL_KINDS = [
  "PROFILE",
  "TASK",
  "REPORT",
  "APPLICATION",
] as const

export type OfficialSealKind = (typeof OFFICIAL_SEAL_KINDS)[number]

export const OFFICIAL_SEAL_KIND_LABELS: Record<OfficialSealKind, string> = {
  PROFILE: "档案归档章",
  TASK: "任务办结章",
  REPORT: "执行汇报章",
  APPLICATION: "申请审批章",
}

export function defaultOfficialSealText(kind: OfficialSealKind) {
  return OFFICIAL_SEAL_KIND_LABELS[kind]
}
