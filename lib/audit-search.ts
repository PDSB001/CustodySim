import { sql, type SQLWrapper } from "drizzle-orm"

/** Keep the query and GIN expression identical so PostgreSQL can use the index. */
export function auditSearchText(
  columns: Record<
    "actorName" | "actionLabel" | "action" | "entityType" | "entityId" | "id",
    SQLWrapper
  >,
) {
  return sql`(${columns.actorName} || ' ' || ${columns.actionLabel} || ' ' || ${columns.action} || ' ' || ${columns.entityType} || ' ' || coalesce(${columns.entityId}::text, '') || ' ' || ${columns.id}::text)`
}
