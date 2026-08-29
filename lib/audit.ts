import { auditLogs } from "@/lib/db/schema"
import type { SessionUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function writeAuditLog(
  {
    actor,
    action,
    actionLabel,
    entityType,
    entityId,
    detail = {},
  }: {
    actor: SessionUser
    action: string
    actionLabel: string
    entityType: string
    entityId?: string | null
    detail?: Record<string, unknown>
  },
  executor: Pick<typeof db, "insert"> = db,
) {
  await executor.insert(auditLogs).values({
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    actionLabel,
    entityType,
    entityId: entityId ?? null,
    detail,
  })
}
