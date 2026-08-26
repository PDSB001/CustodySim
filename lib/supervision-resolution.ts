export type ResolvableScope = { targetType: "USER" | "ORG"; targetId: string }

export function resolveByUserFirst(
  userScopes: ResolvableScope[],
  organizationScopes: ResolvableScope[],
) {
  return userScopes.length ? userScopes : organizationScopes
}
