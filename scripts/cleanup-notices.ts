import { NOTICE_RETENTION_DAYS } from "@/lib/constants"
import { noticeRetentionCutoff, purgeExpiredNotices } from "@/lib/notice-retention"

async function main() {
  const cutoff = noticeRetentionCutoff()
  const deleted = await purgeExpiredNotices()
  console.log(
    `Deleted ${deleted} notices older than ${cutoff.toISOString()} (retention ${NOTICE_RETENTION_DAYS} days)`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Notice cleanup failed", error)
    process.exit(1)
  })
