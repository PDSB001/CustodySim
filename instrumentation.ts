export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGpsPrivacyRetentionScheduler } =
      await import("@/lib/privacy-retention")
    const { startScheduledCustodyStatusScheduler } =
      await import("@/lib/custody-checkin")
    const { startCheckinStatusScheduler, startLeaveSystemMakeupScheduler } =
      await import("@/lib/checkin")
    const { startReportTaskScheduler } = await import("@/lib/task-engine")
    const { startIsolationScheduler } = await import("@/lib/scoring")
    startGpsPrivacyRetentionScheduler()
    startScheduledCustodyStatusScheduler()
    startLeaveSystemMakeupScheduler()
    startCheckinStatusScheduler()
    startReportTaskScheduler()
    startIsolationScheduler()
  }
}
