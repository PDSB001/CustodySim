package com.custodysim.app.location

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 上报调度。
 *
 * 用 WorkManager 而不是常驻 Service：系统会在 Doze / 打盹时自行安排执行时机，
 * 服务端也接受最长 6 小时的滞后，无需为"准时"付出耗电代价。
 */
object LocationScheduler {

    private const val PERIODIC_WORK = "location-report-periodic"
    private const val ONCE_WORK = "location-report-once"

    /** 周期上报。WorkManager 的周期下限是 15 分钟。 */
    fun ensurePeriodic(context: Context, intervalMinutes: Long = LocationPreferences.intervalMinutes(context)) {
        if (!LocationPreferences.isEnabled(context)) {
            cancel(context)
            return
        }
        val request = PeriodicWorkRequestBuilder<LocationReportWorker>(
            intervalMinutes.coerceIn(LocationPreferences.MIN_INTERVAL_MINUTES, LocationPreferences.MAX_INTERVAL_MINUTES),
            TimeUnit.MINUTES,
        )
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    /** 立即上报一次（登录成功、或用户手动点"立即上报"）。 */
    fun reportNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<LocationReportWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            ONCE_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    /** 应用内修改周期后立即替换旧的周期任务。 */
    fun reschedule(context: Context, intervalMinutes: Long = LocationPreferences.intervalMinutes(context)) {
        cancel(context)
        ensurePeriodic(context, intervalMinutes)
    }

    /** 登出或停用上报时取消。 */
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(ONCE_WORK)
    }

    private fun networkConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
}
