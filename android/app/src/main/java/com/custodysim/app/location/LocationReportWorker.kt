package com.custodysim.app.location

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.custodysim.app.CustodySimApp
import com.custodysim.app.data.net.ApiErrorCode
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.net.isRetryable
import kotlinx.coroutines.CancellationException
import com.custodysim.app.R

/**
 * 位置上报的后台任务：采集一个点 → 入队 → 按批上报。
 *
 * 幂等性是安全的：服务端对"不新于已有记录"的点会跳过而不是报错，
 * 所以重复上报不会污染数据，失败了重试即可。
 */
class LocationReportWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as CustodySimApp).container

        // 设置页关闭上报后，即使系统已经唤醒了一个旧任务，也不再采集或上传。
        if (!LocationPreferences.isEnabled(applicationContext)) return Result.success()

        if (!container.hasSession()) {
            return Result.success()
        }

        container.locationReporting.collectIfDue(foreground = false)
        return Result.success()
    }
}

/** Network retries drain the durable queue without waking location providers again. */
class LocationUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as CustodySimApp).container
        if (!container.locationReporting.isEligible() || !LocationPreferences.isEnabled(applicationContext) || !container.hasSession()) return Result.success()
        if (container.pendingPointStore.size() == 0) return Result.success()
        try {
            container.apiClient.restoreAccessTokenIfNeeded()
            val policy = container.locationRepository.fetchPolicy()
            if (!container.active) return Result.success()
            container.pendingPointStore.pruneExpired(policy.maxReportAgeSeconds)
            if (container.pendingPointStore.size() == 0) return Result.success()
            LocationNotifications.show(applicationContext, applicationContext.getString(R.string.location_notification_uploading), uploading = true)

            return when (val result = container.locationUploader.upload(policy.maxPointsPerBatch)) {
                is ApiResult.Ok -> {
                    if (!container.active) return Result.success()
                    LocationNotifications.show(applicationContext, applicationContext.getString(
                        R.string.location_notification_success, result.data.accepted, result.data.skipped))
                    container.locationReporting.record("最近上传成功（新增 ${result.data.accepted} 条，已存在 ${result.data.skipped} 条）")
                    // Points may arrive while an earlier snapshot is being uploaded.
                    if (container.pendingPointStore.size() > 0) Result.retry() else Result.success()
                }

                is ApiResult.Err -> {
                    if (!container.active) return Result.success()
                    LocationNotifications.show(applicationContext, applicationContext.getString(
                        if (result.isRetryable) R.string.location_notification_retry else R.string.location_notification_failed))
                    container.locationReporting.record(if (result.isRetryable) "上传失败，已保留队列并等待重试" else "上传未完成：${result.message}")
                    when {
                    // 限流或服务端故障：保留队列，退避重试
                    result.isRetryable -> Result.retry()
                    // 数据本身不合法（例如时钟漂移过头）：这批永远不会成功，丢弃以免堵住队列
                    result.code == ApiErrorCode.VALIDATION_ERROR ||
                        result.code == ApiErrorCode.CONFLICT -> {
                        Result.success()
                    }
                    // 其余（含 401 会话失效）保留数据，等用户重新登录后由下一轮带走
                    else -> Result.failure()
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            if (container.active) LocationNotifications.cancel(applicationContext)
            throw cancelled
        } catch (_: Exception) {
            if (!container.active) return Result.success()
            LocationNotifications.show(applicationContext, applicationContext.getString(R.string.location_notification_retry))
            container.locationReporting.record("上传异常，已保留队列并等待重试")
            return Result.retry()
        }
    }
}
