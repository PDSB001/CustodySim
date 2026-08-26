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

export const PRISONER_CUSTODY_STATUSES = [
  "IN_CUSTODY",
  "ON_LEAVE",
  "OUT_OF_CUSTODY",
] as const
export type PrisonerCustodyStatus = (typeof PRISONER_CUSTODY_STATUSES)[number]

export const PRISONER_CUSTODY_STATUS_LABELS: Record<
  PrisonerCustodyStatus,
  string
> = {
  IN_CUSTODY: "在押",
  ON_LEAVE: "请假",
  OUT_OF_CUSTODY: "离监",
}

export const AUTH_COOKIE_NAME = "custodysim_session"
export const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 8

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
