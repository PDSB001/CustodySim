export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGpsPrivacyRetentionScheduler } =
      await import("@/lib/privacy-retention")
    startGpsPrivacyRetentionScheduler()
  }
}
