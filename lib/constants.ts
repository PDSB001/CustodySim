export const ROLES = ["ADMIN", "SUPERVISOR", "SUPERVISED"] as const
export type Role = (typeof ROLES)[number]

export const USER_STATUSES = ["active", "disabled"] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const CUSTODY_LEVELS = ["STRICT", "GENERAL", "RELAXED"] as const
export type CustodyLevel = (typeof CUSTODY_LEVELS)[number]

export const CUSTODY_LEVEL_LABELS: Record<CustodyLevel, string> = {
  STRICT: "严管",
  GENERAL: "普管",
  RELAXED: "宽管",
}

export const CUSTODY_CHECKIN_PLAN_LEVELS = [
  ...CUSTODY_LEVELS,
  "ISOLATION",
] as const
export type CustodyCheckinPlanLevel =
  (typeof CUSTODY_CHECKIN_PLAN_LEVELS)[number]

export const CUSTODY_CHECKIN_PLAN_LABELS: Record<
  CustodyCheckinPlanLevel,
  string
> = {
  ...CUSTODY_LEVEL_LABELS,
  ISOLATION: "禁闭加强方案",
}

export const PRISONER_CUSTODY_STATUSES = [
  "IN_CUSTODY",
  "ISOLATION",
  "ON_LEAVE",
  "TEMPORARY_OUT_OF_CUSTODY",
  "OUT_OF_CUSTODY",
] as const
export type PrisonerCustodyStatus = (typeof PRISONER_CUSTODY_STATUSES)[number]

export const PRISONER_CUSTODY_STATUS_LABELS: Record<
  PrisonerCustodyStatus,
  string
> = {
  IN_CUSTODY: "在押",
  ISOLATION: "禁闭执行中",
  ON_LEAVE: "请假状态",
  TEMPORARY_OUT_OF_CUSTODY: "离监",
  OUT_OF_CUSTODY: "未在押",
}

export const AUTH_COOKIE_NAME = "custodysim_session"
export const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 8
export const MFA_CHALLENGE_COOKIE_NAME = "custodysim_mfa_challenge"
export const MFA_TRUSTED_DEVICE_COOKIE_NAME = "custodysim_mfa_trusted_device"
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60
export const MFA_TRUSTED_DEVICE_TTL_SECONDS = 60 * 60 * 24 * 30

export const ORGANIZATION_CATEGORIES = [
  "ROOT",
  "SUPERVISION_ROOT",
  "SUPERVISION_UNIT",
  "SUPERVISED_ROOT",
  "WARD",
  "ROOM",
] as const

export type OrganizationCategory = (typeof ORGANIZATION_CATEGORIES)[number]

export const ORGANIZATION_CATEGORY_LABELS: Record<
  OrganizationCategory,
  string
> = {
  ROOT: "机构",
  SUPERVISION_ROOT: "监管组织",
  SUPERVISION_UNIT: "监管单位",
  SUPERVISED_ROOT: "被监管人员集合",
  WARD: "监区",
  ROOM: "监室",
}
