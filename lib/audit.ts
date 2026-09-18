import { auditLogs } from "@/lib/db/schema"
import { db } from "@/lib/db"
import { getActorType, type AuditActor } from "@/lib/system-identity"

export async function writeAuditLog(
  {
    actor,
    action,
    actionLabel,
    entityType,
    entityId,
    detail = {},
  }: {
    actor: AuditActor
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
    actorType: getActorType(actor),
    action,
    actionLabel,
    entityType,
    entityId: entityId ?? null,
    detail,
  })
}
