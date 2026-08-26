export type TargetScope = { targetType: string; targetId: string }
export type ScopeUser = { id: string; organizationId: string | null }

export function resolveScopes({
  ownScopes,
  groupScopes,
}: {
  ownScopes: TargetScope[]
  groupScopes: TargetScope[]
}) {
  return ownScopes.length ? ownScopes : groupScopes
}

export function expandRuleTargets(
  scopes: TargetScope[],
  descendants: Map<string, Set<string>>,
  supervisedUsers: ScopeUser[],
) {
  return new Set(
    supervisedUsers
      .filter((user) =>
        scopes.some(
          (scope) =>
            (scope.targetType === "USER" && scope.targetId === user.id) ||
            (scope.targetType === "ORG" &&
              Boolean(
                user.organizationId &&
                descendants.get(scope.targetId)?.has(user.organizationId),
              )),
        ),
      )
      .map((user) => user.id),
  )
}
