import type { Role, OrganizationCategory } from "@/lib/constants"

export function validateUserOrganizationAssignment(
  role: Role,
  category: OrganizationCategory | null,
) {
  if (role === "SUPERVISOR" && category !== "SUPERVISION_UNIT")
    return "监管人只能归属到监管单位"
  if (role === "SUPERVISED" && category !== "ROOM")
    return "被监管人必须归属到具体监室"
  return null
}

export function validatePersonOrganizationAssignment(
  category: OrganizationCategory | null,
) {
  return category === "ROOM" ? null : "被监管人员必须归属到具体监室"
}
