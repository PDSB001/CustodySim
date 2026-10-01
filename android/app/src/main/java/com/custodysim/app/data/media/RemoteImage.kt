package com.custodysim.app.data.media

import android.graphics.Bitmap
import android.util.LruCache
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Only this server's API paths may receive its bearer token. No cache-busting parameters. */
fun resolveImageUrl(baseUrl: String, source: String): String? {
    val base = baseUrl.trimEnd('/').toHttpUrlOrNull() ?: return null
    val url = if (source.startsWith("/api/")) {
        (baseUrl.trimEnd('/') + source).toHttpUrlOrNull()
    } else source.toHttpUrlOrNull()
    return url?.takeIf {
        it.scheme == base.scheme && it.host == base.host && it.port == base.port &&
            it.encodedPath.startsWith("/api/") && it.username.isEmpty() && it.password.isEmpty()
    }?.toString()
}

/** Owned by one runtime ApiClient, never shared across servers/sessions. */
class RemoteImageLoader(private val api: ApiClient) {
    private data class Entry(val bytes: ByteArray, val bitmaps: Map<Int, Bitmap>)

    // Same 8 MiB budget and width * height * 4 accounting as ImageThumbs;
    // retained compressed bytes also count, allowing preview decoding without another GET.
    private val cache = object : LruCache<String, Entry>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Entry): Int =
            value.bytes.size + value.bitmaps.values.sumOf { it.width * it.height * 4 }
    }
    private val missing = LruCache<String, Boolean>(256)
    private val mutex = Mutex()
    @Volatile private var generation = 0L

    @Synchronized fun clear() {
        generation++
        cache.evictAll()
        missing.evictAll()
    }

    /** Null failures are not cached except definitive 404s. Cancellation remains cancellation. */
    suspend fun fetchRemoteImage(url: String, maxSize: Int): Bitmap? = withContext(Dispatchers.IO) {
        try {
            val startedGeneration = generation
            mutex.withLock {
                if (startedGeneration != generation) return@withLock null
                if (missing.get(url) == true) return@withLock null
                val cached = cache.get(url)
                cached?.bitmaps?.get(maxSize)?.let { return@withLock it }
                val bytes = cached?.bytes ?: when (val result = api.getBytes(url)) {
                    is ApiResult.Ok -> result.data
                    is ApiResult.Err -> {
                        synchronized(this@RemoteImageLoader) {
                            if (startedGeneration == generation && result.httpStatus == 404) missing.put(url, true)
                        }
                        return@withLock null
                    }
                }
                val bitmap = decodeImageBytes(bytes, maxSize) ?: return@withLock null
                coroutineContext.ensureActive()
                val entry = Entry(bytes, cached?.bitmaps.orEmpty() + (maxSize to bitmap))
                val cost = bytes.size + entry.bitmaps.values.sumOf { it.width * it.height * 4 }
                // A full preview can exceed the entire LRU budget; retain its compressed source
                // instead of inserting an oversized entry which would evict everything, including itself.
                synchronized(this@RemoteImageLoader) {
                    if (startedGeneration != generation) null else {
                        cache.put(url, if (cost <= cache.maxSize()) entry else Entry(bytes, emptyMap()))
                        bitmap
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
    }
}
