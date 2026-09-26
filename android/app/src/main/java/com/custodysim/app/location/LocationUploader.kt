package com.custodysim.app.location

import com.custodysim.app.data.location.BatchReportResult
import com.custodysim.app.data.location.PendingPoint
import com.custodysim.app.data.net.ApiErrorCode
import com.custodysim.app.data.net.ApiResult
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/** One uploader per process: foreground and worker uploads must preserve chronological order. */
class LocationUploader(
    private val snapshot: suspend () -> List<PendingPoint>,
    private val remove: suspend (Set<String>) -> Unit,
    private val report: suspend (List<PendingPoint>) -> ApiResult<BatchReportResult>,
) {
    private val mutex = Mutex()

    suspend fun upload(maxPointsPerBatch: Int): ApiResult<BatchReportResult> = mutex.withLock {
        val pending = snapshot().sortedBy { Instant.parse(it.capturedAt) }
        var total = BatchReportResult(0, 0, 0)
        // Snapshot once: new points belong to the next upload, rather than extending this run.
        for (batch in pending.chunked(maxPointsPerBatch.coerceAtLeast(1))) {
            when (val result = report(batch)) {
                is ApiResult.Ok -> {
                    val received = result.data
                    if (received.accepted < 0 || received.skipped < 0 ||
                        received.accepted.toLong() + received.skipped != batch.size.toLong()) {
                        return@withLock ApiResult.Err(ApiErrorCode.UNKNOWN,
                            "服务器未确认完整批次，定位数据已保留", 502)
                    }
                    remove(batch.map { it.capturedAt }.toSet())
                    total = BatchReportResult(total.accepted + received.accepted,
                        total.skipped + received.skipped, total.crossings + received.crossings)
                }
                is ApiResult.Err -> {
                    // Preserve the worker's policy for permanently invalid batches.
                    if (result.code == ApiErrorCode.VALIDATION_ERROR || result.code == ApiErrorCode.CONFLICT) {
                        remove(batch.map { it.capturedAt }.toSet())
                    }
                    return@withLock result
                }
            }
        }
        ApiResult.Ok(total)
    }
}
