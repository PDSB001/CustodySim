export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGpsPrivacyRetentionScheduler } =
      await import("@/lib/privacy-retention")
    const { startNoticeRetentionScheduler } =
      await import("@/lib/notice-retention")
    const { startAuditLogRetentionScheduler } =
      await import("@/lib/audit-retention")
    const { startScheduledCustodyStatusScheduler } =
      await import("@/lib/custody-checkin")
    const { startCheckinStatusScheduler, startLeaveSystemMakeupScheduler } =
      await import("@/lib/checkin")
    const { startReportTaskScheduler } = await import("@/lib/task-engine")
    const { startIsolationScheduler } = await import("@/lib/scoring")
    const { startAutoReviewScheduler } =
      await import("@/lib/auto-review-server")
    startGpsPrivacyRetentionScheduler()
    startNoticeRetentionScheduler()
    startAuditLogRetentionScheduler()
    startScheduledCustodyStatusScheduler()
    startLeaveSystemMakeupScheduler()
    startCheckinStatusScheduler()
    startReportTaskScheduler()
    startIsolationScheduler()
    startAutoReviewScheduler()
    const { startSecurityMailScheduler } =
      await import("@/lib/security-mail-server")
    startSecurityMailScheduler()
    const { startRegistrationScheduler } =
      await import("@/lib/registration-server")
    startRegistrationScheduler()
    // 本地合并库（mmdb）默认热加载一次，并在 GEOIP_AUTO_UPDATE=true 时每周自查更新。
    const { describeGeoIpDatabase } = await import("@/lib/geoip-database")
    const { startGeoIpUpdateScheduler } = await import("@/lib/geoip-updater")
    const geoip = describeGeoIpDatabase()
    if (!geoip.available)
      console.warn("[geoip] 未找到本地 IP 库：" + geoip.path)
    startGeoIpUpdateScheduler()
  }
}
