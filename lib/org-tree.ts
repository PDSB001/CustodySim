export type OrganizationRecord = {
  id: string
  name: string
  parentId: string | null
  category?: string | null
  sort: number
}

export type OrganizationTreeNode = OrganizationRecord & {
  children: OrganizationTreeNode[]
}

export function buildOrgTree(
  organizations: OrganizationRecord[],
): OrganizationTreeNode[] {
  const nodes = new Map<string, OrganizationTreeNode>()
  organizations.forEach((organization) =>
    nodes.set(organization.id, { ...organization, children: [] }),
  )
  const roots: OrganizationTreeNode[] = []
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  })
  const sortNodes = (items: OrganizationTreeNode[]) => {
    items.sort(
      (left, right) =>
        left.sort - right.sort || left.name.localeCompare(right.name, "zh-CN"),
    )
    items.forEach((item) => sortNodes(item.children))
  }
  sortNodes(roots)
  return roots
}

export function buildOrgPathMap(
  organizations: OrganizationRecord[],
): Map<string, string> {
  const byId = new Map(
    organizations.map((organization) => [organization.id, organization]),
  )
  const paths = new Map<string, string>()
  const getPath = (
    organization: OrganizationRecord,
    seen = new Set<string>(),
  ): string => {
    if (paths.has(organization.id))
      return paths.get(organization.id) ?? organization.name
    if (!organization.parentId || seen.has(organization.id))
      return organization.name
    const parent = byId.get(organization.parentId)
    const path = parent
      ? `${getPath(parent, new Set(seen).add(organization.id))} / ${organization.name}`
      : organization.name
    paths.set(organization.id, path)
    return path
  }
  organizations.forEach((organization) =>
    paths.set(organization.id, getPath(organization)),
  )
  return paths
}

export function buildOrgPathMapFromCategory(
  organizations: OrganizationRecord[],
  startCategory: string,
): Map<string, string> {
  const byId = new Map(
    organizations.map((organization) => [organization.id, organization]),
  )
  const paths = new Map<string, string>()
  organizations.forEach((organization) => {
    const chain: OrganizationRecord[] = []
    const seen = new Set<string>()
    let current: OrganizationRecord | undefined = organization
    while (current && !seen.has(current.id)) {
      chain.unshift(current)
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    const startIndex = chain.findIndex(
      (item) => item.category === startCategory,
    )
    paths.set(
      organization.id,
      chain
        .slice(startIndex >= 0 ? startIndex : 0)
        .map((item) => item.name)
        .join(" / "),
    )
  })
  return paths
}
