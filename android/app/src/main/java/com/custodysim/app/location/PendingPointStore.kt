package com.custodysim.app.location

import android.content.Context
import com.custodysim.app.data.location.PendingPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.time.Instant

/**
 * 待上报点队列：落一个 JSON 文件，进程被杀也不丢。
 *
 * 不引入数据库：服务端只接受 6 小时以内的点，队列天然有上限，
 * 这里按采集时间排序并丢弃超龄数据即可。
 */
class PendingPointStore(context: Context) {

    private val file = File(context.filesDir, "pending_locations.json")
    private val mutex = Mutex()

    /** 队列上限：按最小间隔跑满 6 小时也就 360 个点，留一倍余量。 */
    private val maxQueued = 720

    suspend fun append(points: List<PendingPoint>) {
        if (points.isEmpty()) return
        mutex.withLock {
            val merged = (readAll() + points)
                .distinctBy { it.capturedAt }
                .sortedBy { it.instantOrEpoch() }
            writeAll(merged.takeLast(maxQueued))
        }
    }

    /** 按采集时间升序返回当前队列快照。 */
    suspend fun snapshot(): List<PendingPoint> = mutex.withLock { readAll() }

    /** 移除已成功上报（含服务端跳过的）点。 */
    suspend fun remove(capturedAtValues: Set<String>) {
        if (capturedAtValues.isEmpty()) return
        mutex.withLock {
            writeAll(readAll().filterNot { it.capturedAt in capturedAtValues })
        }
    }

    /** 丢弃超过服务端可接受滞后（默认 6 小时）的点，避免队列越积越多。 */
    suspend fun pruneExpired(maxAgeSeconds: Int) {
        val threshold = Instant.now().minusSeconds(maxAgeSeconds.toLong())
        mutex.withLock {
            val all = readAll()
            val kept = all.filter { it.instantOrEpoch() >= threshold }
            if (kept.size != all.size) writeAll(kept)
        }
    }

    /**
     * 采集时间的解析结果，解析失败按最旧处理（会被优先清理）。
     *
     * 不直接比字符串：`Instant.toString()` 在整秒时会省略小数位，
     * 于是 `"…:31Z"` 会排在 `"…:31.467Z"` 之后，排序与超龄判断都会失准。
     */
    private fun PendingPoint.instantOrEpoch(): Instant =
        runCatching { Instant.parse(capturedAt) }.getOrDefault(Instant.EPOCH)

    suspend fun size(): Int = mutex.withLock { readAll().size }

    private suspend fun readAll(): List<PendingPoint> = withContext(Dispatchers.IO) {
        if (!file.exists()) return@withContext emptyList()
        try {
            val array = JSONArray(file.readText())
            (0 until array.length()).mapNotNull { index ->
                runCatching { PendingPoint.from(array.getJSONObject(index)) }.getOrNull()
            }
        } catch (_: Exception) {
            // 文件损坏就当作空队列，不要让上报链路卡死
            emptyList()
        }
    }

    private suspend fun writeAll(points: List<PendingPoint>) = withContext(Dispatchers.IO) {
        val array = JSONArray()
        points.forEach { array.put(it.toJson()) }
        // 先写临时文件再改名：避免写到一半被杀导致文件损坏
        val temp = File(file.parentFile, "${file.name}.tmp")
        temp.writeText(array.toString())
        if (file.exists()) file.delete()
        temp.renameTo(file)
    }
}
