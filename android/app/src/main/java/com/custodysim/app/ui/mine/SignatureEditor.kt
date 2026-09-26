package com.custodysim.app.ui.mine

import androidx.core.graphics.createBitmap
import android.graphics.Bitmap
import android.graphics.Paint
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.preference.CheckboxPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import java.io.ByteArrayOutputStream

/** A separate drawing window keeps strokes out of the scrolling form/sheet's drag handlers. */
@Composable
internal fun SignatureEditor(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    val strokes = remember { mutableStateListOf<List<Offset>>() }
    var acknowledged by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Dialog(onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Card(Modifier.fillMaxWidth().widthIn(max = AppSpace.contentWidth).padding(AppSpace.page),
            insideMargin = PaddingValues(AppSpace.page)) {
            Column(Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                Text("手写签名", style = MiuixTheme.textStyles.title2)
                Text("请核对档案后由本人签写。签名将用于档案确认，服务器加密保存。",
                    style = MiuixTheme.textStyles.footnote1)
                CheckboxPreference(title = "我已知悉并自愿使用手写签名", checked = acknowledged,
                    onCheckedChange = { if (!busy) acknowledged = it })
                Canvas(Modifier.fillMaxWidth().aspectRatio(2.4f)
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .border(1.dp, MiuixTheme.colorScheme.outline, RoundedCornerShape(16.dp))
                    .pointerInput(acknowledged, busy) {
                        if (!acknowledged || busy) return@pointerInput
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            fun normalize(point: Offset) = Offset(
                                (point.x / size.width).coerceIn(0f, 1f),
                                (point.y / size.height).coerceIn(0f, 1f))
                            down.consume()
                            strokes.add(listOf(normalize(down.position)))
                            val index = strokes.lastIndex
                            do {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                change.consume()
                                strokes[index] = strokes[index] + normalize(change.position)
                            } while (change.pressed)
                        }
                    }) {
                    strokes.forEach { stroke ->
                        val points = stroke.map { Offset(it.x * size.width, it.y * size.height) }
                        if (points.size == 1) drawCircle(Color(0xFF172554), size.width / 400f, points.first())
                        points.zipWithNext().forEach { (from, to) ->
                            drawLine(Color(0xFF172554), from, to, size.width / 200f, StrokeCap.Round)
                        }
                    }
                }
                Text(if (acknowledged) "在白色区域签写；重写会清空本次笔迹。" else "勾选确认后即可签写。",
                    style = MiuixTheme.textStyles.footnote1)
                error?.let { Text(it, color = MiuixTheme.colorScheme.error) }
                Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                    TextButton("取消", onClick = onDismiss, enabled = !busy, modifier = Modifier.weight(1f))
                    TextButton("重写", onClick = { strokes.clear() }, enabled = !busy && strokes.isNotEmpty(), modifier = Modifier.weight(1f))
                    TextButton("使用签名", enabled = !busy && acknowledged && strokes.isNotEmpty(),
                        colors = ButtonDefaults.textButtonColorsPrimary(), modifier = Modifier.weight(1f),
                        onClick = {
                            val snapshot = strokes.map { it.toList() }
                            busy = true
                            scope.launch {
                                try {
                                    val data = withContext(Dispatchers.Default) { encodeSignature(snapshot) }
                                    onConfirm(data)
                                } catch (_: Exception) { error = "签名生成失败，请重试" }
                                finally { busy = false }
                            }
                        })
                }
            }
        }
    }
}

internal fun encodeSignature(strokes: List<List<Offset>>): String {
    val bitmap = createBitmap(960, 400)
    try {
        val canvas = android.graphics.Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.WHITE)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(23, 37, 84)
            strokeWidth = 4.8f
            strokeCap = Paint.Cap.ROUND
        }
        strokes.forEach { points ->
            points.firstOrNull()?.let { canvas.drawCircle(it.x * 960, it.y * 400, 2.4f, paint) }
            points.zipWithNext().forEach { (a, b) -> canvas.drawLine(a.x * 960, a.y * 400, b.x * 960, b.y * 400, paint) }
        }
        val bytes = ByteArrayOutputStream().use {
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
            it.toByteArray()
        }
        val result = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        check(result.length <= 750_000)
        return result
    } finally { bitmap.recycle() }
}
