import {
  buildOrgTree,
  type OrganizationRecord,
  type OrganizationTreeNode,
} from "@/lib/org-tree"

export function buildEffectiveCategoryMap(
  organizations: OrganizationRecord[],
): Map<string, string | null> {
  const byId = new Map(
    organizations.map((organization) => [organization.id, organization]),
  )
  const categories = new Map<string, string | null>()
  const resolve = (
    organization: OrganizationRecord,
    seen = new Set<string>(),
  ): string | null => {
    if (categories.has(organization.id))
      return categories.get(organization.id) ?? null
    if (organization.category) return organization.category
    if (!organization.parentId || seen.has(organization.id)) return null
    const parent = byId.get(organization.parentId)
    return parent ? resolve(parent, new Set(seen).add(organization.id)) : null
  }
  organizations.forEach((organization) =>
    categories.set(organization.id, resolve(organization)),
  )
  return categories
}

export function buildCategoryOrgTree(
  organizations: OrganizationRecord[],
  category: string,
): OrganizationTreeNode[] {
  const effectiveCategories = buildEffectiveCategoryMap(organizations)
  return buildOrgTree(
    organizations.filter(
      (organization) => effectiveCategories.get(organization.id) === category,
    ),
  )
}
