package com.custodysim.app.ui.common

import android.graphics.BitmapFactory
import android.util.Base64
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.res.stringResource
import com.custodysim.app.R
import com.custodysim.app.data.media.ImagePipeline
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Clear
import top.yukonga.miuix.kmp.theme.MiuixTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.padding
import androidx.compose.animation.animateContentSize
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp

/** 把 data URL 解码成 ImageBitmap（异步、可空）。 */
@Composable
fun rememberDataUrlImage(dataUrl: String?): ImageBitmap? {
    val image by produceState<ImageBitmap?>(null, dataUrl) {
        value = withContext(Dispatchers.Default) { dataUrl?.let { decodeDataUrl(it) } }
    }
    return image
}

/** 一行缩略图，用于展示打卡照片、补卡凭证、任务/申请附件。 */
@Composable
fun ImageThumbs(images: List<String>, modifier: Modifier = Modifier, onRemove: ((Int) -> Unit)? = null) {
    Row(modifier = modifier.animateContentSize().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
        images.forEachIndexed { index, url ->
            Column(Modifier.width(112.dp)) {
            val bitmap = rememberDataUrlImage(url)
            if (bitmap != null) {
                Box(Modifier.size(112.dp).clip(RoundedCornerShape(AppShape.thumbnail))) {
                    Image(bitmap = bitmap,
                        contentDescription = stringResource(R.string.attachment, index + 1),
                        modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    onRemove?.let { remove ->
                        IconButton(onClick = { remove(index) },
                            modifier = Modifier.align(Alignment.TopEnd).padding(AppSpace.tiny),
                            minWidth = 32.dp, minHeight = 32.dp,
                            backgroundColor = MiuixTheme.colorScheme.surface.copy(alpha = 0.90f)) {
                            Icon(MiuixIcons.Clear,
                                contentDescription = stringResource(R.string.remove_image, index + 1),
                                tint = MiuixTheme.colorScheme.error)
                        }
                    }
                }
            } else {
                Text(stringResource(R.string.image_unavailable), style = MiuixTheme.textStyles.footnote1)
            }
            }
        }
    }
}

/**
 * 列表/表单里的缩略图最大也就 200dp 高，先读尺寸再按需降采样就够了。
 * 原图（上传管线会压到 1600px）整张解码要好几 MB，滚动时反复分配/回收就是掉帧来源。
 */
private const val THUMBNAIL_TARGET_PX = 512

/**
 * 解码结果按 data URL 缓存。
 *
 * 图片是随条目进出组合的：没有缓存时，每次滚回来都要重新 base64 解码 + 解码位图，
 * 长列表里来回滑动就会一直重复这份开销。按位图像素字节数计费，超预算自动淘汰。
 */
private const val THUMBNAIL_CACHE_BYTES = 8 * 1024 * 1024

private val thumbnailCache = object : LruCache<String, ImageBitmap>(THUMBNAIL_CACHE_BYTES) {
    override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
}

private fun decodeDataUrl(dataUrl: String): ImageBitmap? {
    thumbnailCache.get(dataUrl)?.let { return it }
    val decoded = runCatching {
        val base64 = dataUrl.substringAfter("base64,", "")
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply {
            inSampleSize = ImagePipeline.sampleSizeFor(bounds.outWidth, bounds.outHeight, THUMBNAIL_TARGET_PX)
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
    }.getOrNull() ?: return null
    thumbnailCache.put(dataUrl, decoded)
    return decoded
}
