package com.custodysim.app.location

import com.custodysim.app.data.location.BatchReportResult
import com.custodysim.app.data.location.PendingPoint
import com.custodysim.app.data.net.ApiErrorCode
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.net.isRetryable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class LocationUploaderTest {
    private fun point(time: String) = PendingPoint(30.0, 120.0, 10.0, "2026-09-25T00:00:$time")
    private fun ok(size: Int) = ApiResult.Ok(BatchReportResult(size, 0, 0))
    private val offline = ApiResult.Err(ApiErrorCode.UNKNOWN, "offline", 0)

    private fun uploader(queue: MutableList<PendingPoint>, report: suspend (List<PendingPoint>) -> ApiResult<BatchReportResult>) =
        LocationUploader({ queue.toList() }, { ids -> queue.removeAll { it.capturedAt in ids } }, report)

    @Test fun `upload is chronological and acknowledges every chunk`() = runBlocking {
        val earlier = point("01Z")
        val later = point("01.100Z") // String sorting would incorrectly reverse these.
        val queue = mutableListOf(later, earlier, point("02Z"))
        val calls = mutableListOf<List<PendingPoint>>()
        val result = uploader(queue) { batch -> calls.add(batch); ok(batch.size) }.upload(2)
        assertEquals(listOf(earlier, later), calls[0])
        assertEquals(listOf(2, 1), calls.map { it.size })
        assertEquals(ok(3), result)
        assertTrue(queue.isEmpty())
    }

    @Test fun `network failure preserves failed and unattempted batches`() = runBlocking {
        val queue = mutableListOf(point("01Z"), point("02Z"), point("03Z"))
        var calls = 0
        val result = uploader(queue) { if (++calls == 1) ok(it.size) else offline }.upload(1)
        assertEquals(offline, result)
        assertEquals(listOf(point("02Z"), point("03Z")), queue)
        assertEquals(2, calls)
        assertTrue(offline.isRetryable)
        assertFalse(ApiResult.Err(ApiErrorCode.UNAUTHORIZED, "expired", 401).isRetryable)
    }

    @Test fun `skipped points are acknowledged too`() = runBlocking {
        val queue = mutableListOf(point("01Z"), point("02Z"))
        val result = uploader(queue) { ApiResult.Ok(BatchReportResult(1, 1, 0)) }.upload(10)
        assertEquals(ApiResult.Ok(BatchReportResult(1, 1, 0)), result)
        assertTrue(queue.isEmpty())
    }

    @Test fun `incomplete acknowledgement retains the batch`() = runBlocking {
        val queue = mutableListOf(point("01Z"), point("02Z"))
        val result = uploader(queue) { ok(1) }.upload(10)
        assertTrue(result is ApiResult.Err)
        assertEquals(2, queue.size)
    }

    @Test fun `concurrent callers cannot send the same snapshot`() = runBlocking {
        val queue = mutableListOf(point("01Z"))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val uploader = uploader(queue) { batch ->
            calls++; started.complete(Unit); release.await(); ok(batch.size)
        }
        val first = async { uploader.upload(10) }
        started.await()
        val second = async { uploader.upload(10) }
        release.complete(Unit)
        first.await(); second.await()
        assertEquals(1, calls)
        assertTrue(queue.isEmpty())
    }

    @Test fun `new points during upload remain queued`() = runBlocking {
        val queue = mutableListOf(point("01Z"))
        uploader(queue) { batch -> queue.add(point("02Z")); ok(batch.size) }.upload(10)
        assertEquals(listOf(point("02Z")), queue)
    }

    @Test fun `cancellation retains data and releases the upload lock`() = runBlocking {
        val queue = mutableListOf(point("01Z"))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val uploader = uploader(queue) { batch ->
            if (++calls == 1) { started.complete(Unit); release.await() }
            ok(batch.size)
        }
        val job = launch { uploader.upload(10) }
        started.await(); job.cancelAndJoin()
        assertEquals(1, queue.size)
        assertEquals(ok(1), uploader.upload(10))
        assertTrue(queue.isEmpty())
    }

    @Test fun `invalid batch does not discard later batches`() = runBlocking {
        val queue = mutableListOf(point("01Z"), point("02Z"))
        val invalid = ApiResult.Err(ApiErrorCode.VALIDATION_ERROR, "invalid point", 400)
        assertEquals(invalid, uploader(queue) { invalid }.upload(1))
        assertEquals(listOf(point("02Z")), queue)
    }

    @Test fun `empty queue does not call network`() = runBlocking {
        assertEquals(ok(0), uploader(mutableListOf()) { error("Unexpected network call") }.upload(10))
    }
}
