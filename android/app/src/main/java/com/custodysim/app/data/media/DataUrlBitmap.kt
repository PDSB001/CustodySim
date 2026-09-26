package com.custodysim.app.data.media

import androidx.core.graphics.createBitmap
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.Base64
import com.caverock.androidsvg.SVG
import kotlin.math.roundToInt

/** Shared by previews and archive export; formatted signatures and seals arrive as SVG. */
fun decodeDataUrlBitmap(data: String?, maxSize: Int): Bitmap? = runCatching {
    if (data == null || !data.startsWith("data:image/") || data.length > 8_000_000) return null
    val header = data.substringBefore(',')
    if (!header.endsWith(";base64")) return null
    val bytes = Base64.decode(data.substringAfter(','), Base64.DEFAULT)
    if (header.startsWith("data:image/svg+xml")) {
        val svg = SVG.getFromInputStream(bytes.inputStream())
        val bounds = svg.documentViewBox
        val width = svg.documentWidth.takeIf { it > 0f } ?: bounds?.width() ?: 640f
        val height = svg.documentHeight.takeIf { it > 0f } ?: bounds?.height() ?: 200f
        val scale = (maxSize.toFloat() / maxOf(width, height)).coerceAtMost(1f)
        createBitmap((width * scale).roundToInt().coerceAtLeast(1),
            (height * scale).roundToInt().coerceAtLeast(1)).also {
            svg.documentWidth = it.width.toFloat()
            svg.documentHeight = it.height.toFloat()
            svg.renderToCanvas(Canvas(it))
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply {
            inSampleSize = ImagePipeline.sampleSizeFor(bounds.outWidth, bounds.outHeight, maxSize)
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }
}.getOrNull()
