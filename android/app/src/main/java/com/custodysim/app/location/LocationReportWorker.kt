package com.custodysim.app.location

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.custodysim.app.CustodySimApp
import com.custodysim.app.data.net.ApiErrorCode
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.net.isRetryable

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

        // 未登录就不采集：没有令牌上报必然 401，白白唤醒网络
        if (container.authRepository.trustedDevice() == null && !container.hasSession()) {
            return Result.success()
        }

        container.locationCollector.collectOnce()?.let { point ->
            container.pendingPointStore.append(listOf(point))
        }

        val policy = container.locationRepository.fetchPolicy()
        container.pendingPointStore.pruneExpired(policy.maxReportAgeSeconds)

        val batch = container.pendingPointStore.snapshot().take(policy.maxPointsPerBatch)
        if (batch.isEmpty()) return Result.success()

        return when (val result = container.locationRepository.reportBatch(batch)) {
            is ApiResult.Ok -> {
                // accepted 与 skipped 都算"服务端已收到"，从队列移除
                container.pendingPointStore.remove(batch.map { it.capturedAt }.toSet())
                Result.success()
            }

            is ApiResult.Err -> when {
                // 限流或服务端故障：保留队列，退避重试
                result.isRetryable -> Result.retry()
                // 数据本身不合法（例如时钟漂移过头）：这批永远不会成功，丢弃以免堵住队列
                result.code == ApiErrorCode.VALIDATION_ERROR ||
                    result.code == ApiErrorCode.CONFLICT -> {
                    container.pendingPointStore.remove(batch.map { it.capturedAt }.toSet())
                    Result.success()
                }
                // 其余（含 401 会话失效）保留数据，等用户重新登录后由下一轮带走
                else -> Result.failure()
            }
        }
    }
}
