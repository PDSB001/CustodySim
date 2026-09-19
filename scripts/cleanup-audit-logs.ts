import { AUDIT_LOG_RETENTION_DAYS } from "@/lib/constants"
import {
  auditLogRetentionCutoff,
  purgeExpiredAuditLogs,
} from "@/lib/audit-retention"

async function main() {
  const cutoff = auditLogRetentionCutoff()
  const deleted = await purgeExpiredAuditLogs()
  console.log(
    `Deleted ${deleted} audit logs older than ${cutoff.toISOString()} (retention ${AUDIT_LOG_RETENTION_DAYS} days)`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Audit log cleanup failed", error)
    process.exit(1)
  })
