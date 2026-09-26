package com.custodysim.app.ui.mine

import androidx.core.graphics.createBitmap
import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.custodysim.app.data.media.decodeDataUrlBitmap
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/** 圆形预览与最终 JPEG 共用同一个源图裁剪矩形。 */
@Composable
fun AvatarCropper(source: String, onCancel: () -> Unit, onConfirm: (String) -> Unit) {
    val bitmap by produceState<Pair<Boolean, Bitmap?>>(false to null, source) {
        value = true to withContext(Dispatchers.Default) { decodeDataUrlBitmap(source, 2048) }
    }
    var zoom by remember(source) { mutableFloatStateOf(1f) }
    var center by remember(source) { mutableStateOf(Offset(0.5f, 0.5f)) }
    val image = bitmap.second
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
        if (image == null) Text(if (bitmap.first) "图片读取失败，请重新选择" else "正在读取图片…") else {
            val rendered = remember(image) { image.asImageBitmap() }
            val side = (minOf(image.width, image.height) / zoom).roundToInt().coerceAtLeast(1)
            val left = (center.x * image.width - side / 2f).roundToInt().coerceIn(0, image.width - side)
            val top = (center.y * image.height - side / 2f).roundToInt().coerceIn(0, image.height - side)
            Canvas(Modifier.widthIn(max = 260.dp).fillMaxWidth().aspectRatio(1f)
                .pointerInput(image) {
                    detectTransformGestures { _, pan, scale, _ ->
                        val previousSide = minOf(image.width, image.height) / zoom
                        val previousX = center.x.coerceIn(previousSide / 2 / image.width, 1f - previousSide / 2 / image.width)
                        val previousY = center.y.coerceIn(previousSide / 2 / image.height, 1f - previousSide / 2 / image.height)
                        zoom = (zoom * scale).coerceIn(1f, 4f)
                        val half = minOf(image.width, image.height) / zoom / 2f
                        center = Offset(
                            (previousX - pan.x * previousSide / size.width / image.width).coerceIn(half / image.width, 1f - half / image.width),
                            (previousY - pan.y * previousSide / size.height / image.height).coerceIn(half / image.height, 1f - half / image.height))
                    }
                }) {
                clipPath(Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset.Zero, size)) }) {
                    drawRect(Color.White)
                    drawImage(rendered, srcOffset = IntOffset(left, top), srcSize = IntSize(side, side),
                        dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()))
                }
                drawCircle(Color.White.copy(alpha = 0.8f), radius = size.minDimension / 2 - 1.dp.toPx(), style = Stroke(2.dp.toPx()))
            }
            Text("拖动调整位置，双指缩放")
            Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                TextButton(text = "缩小", enabled = zoom > 1f, onClick = { zoom = (zoom - 0.25f).coerceAtLeast(1f) })
                TextButton(text = "重置", onClick = { zoom = 1f; center = Offset(0.5f, 0.5f) })
                TextButton(text = "放大", enabled = zoom < 4f, onClick = { zoom = (zoom + 0.25f).coerceAtMost(4f) })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                TextButton(text = "取消裁剪", onClick = onCancel)
                TextButton(text = "使用此裁剪", onClick = {
                    val output = createBitmap(192, 192)
                    android.graphics.Canvas(output).apply {
                        drawColor(android.graphics.Color.WHITE)
                        drawBitmap(image, android.graphics.Rect(left, top, left + side, top + side),
                            android.graphics.Rect(0, 0, 192, 192), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
                    }
                    val bytes = ByteArrayOutputStream().use { stream -> output.compress(Bitmap.CompressFormat.JPEG, 80, stream); stream.toByteArray() }
                    output.recycle()
                    onConfirm("data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
                })
            }
        }
        if (image == null) TextButton(text = "取消裁剪", onClick = onCancel)
    }
}
