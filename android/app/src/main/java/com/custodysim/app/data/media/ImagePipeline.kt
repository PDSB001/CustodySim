package com.custodysim.app.data.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 图片转 data URL 的统一管线，打卡/补卡/任务/申请附件共用。服务端要求 <=1MB。 */
object ImagePipeline {

    const val MAX_BYTES = 1_000_000
    const val MAX_DIMENSION = 1600

    /** 等比缩放尺寸（纯函数，可单测）。 */
    fun scaledSize(width: Int, height: Int, max: Int): Pair<Int, Int> {
        if (width <= 0 || height <= 0 || max <= 0) return width to height
        val longest = maxOf(width, height)
        if (longest <= max) return width to height
        val scale = max.toDouble() / longest
        return (width * scale).toInt().coerceAtLeast(1) to (height * scale).toInt().coerceAtLeast(1)
    }

    /**
     * 2 的幂次降采样系数（纯函数，可单测），保证解码后最长边不小于 [targetPx]。
     *
     * 列表缩略图、导出画布这类「目标就是固定小尺寸」的场景用它，
     * 避免把原图整张解码出来 —— 一张 1600px 的照片解码后要好几 MB，
     * 滚动时反复分配/回收会直接反映成掉帧。
     */
    fun sampleSizeFor(width: Int, height: Int, targetPx: Int): Int {
        if (width <= 0 || height <= 0 || targetPx <= 0) return 1
        var sample = 1
        while (maxOf(width, height) / (sample * 2) >= targetPx) sample *= 2
        return sample
    }

    /** 把一张图压成 JPEG data URL；读取失败返回 null。 */
    suspend fun compressToDataUrl(context: Context, uri: Uri): String? =
        withContext(Dispatchers.IO) {
            val bitmap = decodeScaled(context, uri) ?: return@withContext null
            try {
                var quality = 90
                while (quality >= 40) {
                    val bytes = ByteArrayOutputStream().use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
                        out.toByteArray()
                    }
                    if (bytes.size <= MAX_BYTES || quality == 40) {
                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        return@withContext "data:image/jpeg;base64,$base64"
                    }
                    quality -= 10
                }
                null
            } finally {
                bitmap.recycle()
            }
        }

    private fun decodeScaled(context: Context, uri: Uri): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            null
        } else {
            val (targetWidth, targetHeight) =
                scaledSize(bounds.outWidth, bounds.outHeight, MAX_DIMENSION)
            var sampleSize = 1
            while (bounds.outWidth / (sampleSize * 2) >= targetWidth &&
                bounds.outHeight / (sampleSize * 2) >= targetHeight
            ) {
                sampleSize *= 2
            }
            val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
            val decoded = context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, decodeOptions)
            } ?: return null
            applyExifRotation(context, uri, decoded)
        }
    } catch (_: Exception) {
        null
    }

    /** 相册照片常带旋转标记，不处理会横竖颠倒。 */
    private fun applyExifRotation(context: Context, uri: Uri, bitmap: Bitmap): Bitmap = try {
        val degrees = context.contentResolver.openInputStream(uri)?.use { input ->
            when (
                ExifInterface(input).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL,
                )
            ) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } ?: 0f
        if (degrees == 0f) {
            bitmap
        } else {
            val matrix = Matrix().apply { postRotate(degrees) }
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (rotated != bitmap) bitmap.recycle()
            rotated
        }
    } catch (_: Exception) {
        bitmap
    }
}

