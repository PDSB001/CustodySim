package com.custodysim.app.data.net

import okhttp3.RequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer

/** Reports request-body bytes written, not server acceptance. Each retry starts a new attempt. */
internal class ProgressRequestBody(
    private val delegate: RequestBody,
    private val onProgress: (Int) -> Unit,
) : RequestBody() {
    override fun contentType() = delegate.contentType()
    override fun contentLength() = delegate.contentLength()
    override fun isOneShot() = delegate.isOneShot()

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength()
        var written = 0L
        var lastPercent = 0
        onProgress(0)
        val counting = object : ForwardingSink(sink) {
            override fun write(source: Buffer, byteCount: Long) {
                var remaining = byteCount
                while (remaining > 0) {
                    val chunk = minOf(remaining, 16 * 1024L)
                    super.write(source, chunk)
                    remaining -= chunk
                    written += chunk
                    val percent = if (total > 0) (written * 100 / total).toInt().coerceIn(0, 100) else 0
                    if (percent != lastPercent) {
                        lastPercent = percent
                        onProgress(percent)
                    }
                }
            }
        }.buffer()
        delegate.writeTo(counting)
        counting.flush()
    }
}
