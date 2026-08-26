import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  organizations,
  supervisionRelationScopes,
  supervisionRelations,
  users,
} from "@/lib/db/schema"
import type { SessionUser } from "@/lib/session"

type OrganizationNode = { id: string; parentId: string | null }
type ScopedUser = { id: string; organizationId: string | null }
type Scope = { side: string; targetType: string; targetId: string }

export function buildOrgDescendantsMap(organizations: OrganizationNode[]) {
  const children = new Map<string, string[]>()
  for (const organization of organizations) {
    if (!organization.parentId) continue
    children.set(organization.parentId, [
      ...(children.get(organization.parentId) ?? []),
      organization.id,
    ])
  }
  return new Map(
    organizations.map((organization) => {
      const descendants = new Set<string>([organization.id])
      const queue = [organization.id]
      while (queue.length) {
        const current = queue.shift()
        if (!current) continue
        for (const child of children.get(current) ?? []) {
          descendants.add(child)
          queue.push(child)
        }
      }
      return [organization.id, descendants]
    }),
  )
}

function scopeMatchesUser(
  scope: Scope,
  user: ScopedUser,
  descendants: Map<string, Set<string>>,
) {
  if (scope.targetType === "USER") return scope.targetId === user.id
  return Boolean(
    user.organizationId &&
    descendants.get(scope.targetId)?.has(user.organizationId),
  )
}

function expandScopesToUsers(
  scopes: Scope[],
  candidates: ScopedUser[],
  descendants: Map<string, Set<string>>,
) {
  return new Set(
    candidates
      .filter((candidate) =>
        scopes.some((scope) => scopeMatchesUser(scope, candidate, descendants)),
      )
      .map((candidate) => candidate.id),
  )
}

async function getScopeContext() {
  const [allOrganizations, allUsers, activeRelations, allScopes] =
    await Promise.all([
      db
        .select({ id: organizations.id, parentId: organizations.parentId })
        .from(organizations),
      db
        .select({
          id: users.id,
          organizationId: users.organizationId,
          role: users.role,
          status: users.status,
        })
        .from(users),
      db
        .select({ id: supervisionRelations.id })
        .from(supervisionRelations)
        .where(eq(supervisionRelations.status, "active")),
      db.select().from(supervisionRelationScopes),
    ])
  return {
    allUsers,
    activeRelations,
    allScopes,
    descendants: buildOrgDescendantsMap(allOrganizations),
  }
}

export async function getSupervisedUserIdsForSupervisor(supervisorId: string) {
  const context = await getScopeContext()
  const supervisor = context.allUsers.find((user) => user.id === supervisorId)
  if (!supervisor) return new Set<string>()
  const relationIds = new Set(
    context.activeRelations.map((relation) => relation.id),
  )
  const supervised = context.allUsers.filter(
    (user) => user.role === "SUPERVISED" && user.status === "active",
  )
  const result = new Set<string>()
  for (const relationId of relationIds) {
    const scopes = context.allScopes.filter(
      (scope) => scope.relationId === relationId,
    )
    if (
      !scopes
        .filter((scope) => scope.side === "SUPERVISOR")
        .some((scope) =>
          scopeMatchesUser(scope, supervisor, context.descendants),
        )
    )
      continue
    for (const id of expandScopesToUsers(
      scopes.filter((scope) => scope.side === "SUPERVISED"),
      supervised,
      context.descendants,
    ))
      result.add(id)
  }
  return result
}

export async function getSupervisorIdsForSupervised(supervisedId: string) {
  const context = await getScopeContext()
  const supervised = context.allUsers.find((user) => user.id === supervisedId)
  if (!supervised) return new Set<string>()
  const supervisors = context.allUsers.filter(
    (user) => user.role === "SUPERVISOR" && user.status === "active",
  )
  const result = new Set<string>()
  for (const relation of context.activeRelations) {
    const scopes = context.allScopes.filter(
      (scope) => scope.relationId === relation.id,
    )
    if (
      !scopes
        .filter((scope) => scope.side === "SUPERVISED")
        .some((scope) =>
          scopeMatchesUser(scope, supervised, context.descendants),
        )
    )
      continue
    for (const id of expandScopesToUsers(
      scopes.filter((scope) => scope.side === "SUPERVISOR"),
      supervisors,
      context.descendants,
    ))
      result.add(id)
  }
  return result
}

export async function isEffectiveSupervisorForSupervised(
  actor: SessionUser,
  supervisedId: string,
) {
  if (actor.role === "ADMIN") return true
  if (actor.role !== "SUPERVISOR") return false
  return (await getSupervisedUserIdsForSupervisor(actor.id)).has(supervisedId)
}

export async function getSupervisedUserIdsForActor(actor: SessionUser) {
  if (actor.role === "ADMIN") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "SUPERVISED"), eq(users.status, "active")))
    return new Set(rows.map((row) => row.id))
  }
  if (actor.role === "SUPERVISOR")
    return getSupervisedUserIdsForSupervisor(actor.id)
  return new Set([actor.id])
}

export async function isUserInSupervisionScopeForActor(
  actor: SessionUser,
  supervisedId: string,
) {
  return (await getSupervisedUserIdsForActor(actor)).has(supervisedId)
}

export async function getAdminUserId() {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "ADMIN"))
    .limit(1)
  return admin?.id ?? null
}
