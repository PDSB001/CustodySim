import { type OrganizationCategory } from "@/lib/constants"
import type { OrganizationRecord } from "@/lib/org-tree"

type CategorizedOrganization = OrganizationRecord & { category: string | null }

const CHILD_CATEGORIES: Record<OrganizationCategory, OrganizationCategory[]> = {
  ROOT: ["SUPERVISION_ROOT", "SUPERVISED_ROOT"],
  SUPERVISION_ROOT: ["SUPERVISION_UNIT"],
  SUPERVISION_UNIT: ["SUPERVISION_UNIT"],
  SUPERVISED_ROOT: ["WARD"],
  WARD: ["ROOM"],
  ROOM: [],
}

export function getAllowedChildCategories(category: OrganizationCategory) {
  return CHILD_CATEGORIES[category]
}

export function validateOrganizationPlacement({
  organizations,
  parentId,
  category,
  selfId,
}: {
  organizations: CategorizedOrganization[]
  parentId: string | null
  category: OrganizationCategory
  selfId?: string
}) {
  const parent = parentId
    ? organizations.find((organization) => organization.id === parentId)
    : undefined
  if (category === "ROOT") {
    if (parentId) return "机构不能设置上级组织"
    if (
      organizations.some(
        (organization) =>
          organization.category === "ROOT" && organization.id !== selfId,
      )
    )
      return "系统只能存在一个顶级机构"
  } else {
    if (!parent) return "请选择有效的上级组织"
    if (
      !parent.category ||
      !getAllowedChildCategories(
        parent.category as OrganizationCategory,
      ).includes(category)
    )
      return `“${parent.name}”下不能创建该类型组织`
  }
  const directChildren = organizations.filter(
    (organization) => organization.parentId === selfId,
  )
  if (
    selfId &&
    directChildren.some(
      (child) =>
        !child.category ||
        !getAllowedChildCategories(category).includes(
          child.category as OrganizationCategory,
        ),
    )
  )
    return "调整组织类型会破坏现有下级层级"
  return null
}
