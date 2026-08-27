export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGpsPrivacyRetentionScheduler } =
      await import("@/lib/privacy-retention")
    const { startScheduledCustodyStatusScheduler } =
      await import("@/lib/custody-checkin")
    startGpsPrivacyRetentionScheduler()
    startScheduledCustodyStatusScheduler()
  }
}
