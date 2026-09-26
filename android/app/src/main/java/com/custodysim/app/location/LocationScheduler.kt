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
 * 上传前按服务端策略剔除超龄点；不使用常驻 GPS 或唤醒锁保证精确周期。
 */
object LocationScheduler {

    private const val PERIODIC_WORK = "location-report-periodic"
    private const val ONCE_WORK = "location-report-once"
    private const val UPLOAD_WORK = "location-upload-pending"

    /** 周期上报。WorkManager 的周期下限是 15 分钟。 */
    fun ensurePeriodic(context: Context, intervalMinutes: Long = LocationPreferences.intervalMinutes(context)) {
        if (!LocationPreferences.isEnabled(context)) {
            cancel(context)
            return
        }
        val request = PeriodicWorkRequestBuilder<LocationReportWorker>(
            intervalMinutes.coerceIn(15L, LocationPreferences.MAX_INTERVAL_MINUTES),
            TimeUnit.MINUTES,
        )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    /** 唤醒一次到期检查；用户主动上报由首页单独处理。 */
    fun reportNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<LocationReportWorker>()
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            ONCE_WORK,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    /** 应用内修改周期后立即替换旧的周期任务。 */
    fun reschedule(context: Context, intervalMinutes: Long = LocationPreferences.intervalMinutes(context)) {
        ensurePeriodic(context, intervalMinutes)
        LocationIntervalService.sync(context)
    }

    /** 登出或停用上报时取消。 */
    fun cancel(context: Context) {
        context.stopService(android.content.Intent(context, LocationIntervalService::class.java))
        LocationNotifications.cancel(context)
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(ONCE_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(UPLOAD_WORK)
    }

    /** Wait for cancellation to be recorded before scheduling against another server. */
    suspend fun cancelAndAwait(context: Context) {
        context.stopService(android.content.Intent(context, LocationIntervalService::class.java))
        LocationNotifications.cancel(context)
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val manager = WorkManager.getInstance(context)
            listOf(PERIODIC_WORK, ONCE_WORK, UPLOAD_WORK).forEach {
                manager.cancelUniqueWork(it).result.get(10, TimeUnit.SECONDS)
            }
        }
    }

    fun uploadPending(context: Context) {
        val request = OneTimeWorkRequestBuilder<LocationUploadWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(UPLOAD_WORK, ExistingWorkPolicy.KEEP, request)
    }

    private fun networkConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
}
