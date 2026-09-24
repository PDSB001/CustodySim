package com.custodysim.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpSize
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import top.yukonga.miuix.kmp.squircle.LocalSquircleEnabled
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.overlay.OverlayBottomSheet

/** MiuiX 底部弹层的薄封装，统一 show/title/onDismiss 用法。 */
@Composable
fun OverlaySheet(
    show: Boolean,
    title: String,
    onDismiss: () -> Unit,
    busy: Boolean = false,
    onDismissFinished: () -> Unit = {},
    /**
     * 是否保留 MiuiX 的 squircle（连续圆角）渲染。
     *
     * 开着时每个 Card/Button 都要走 RuntimeShader，Card/Button 还要额外合成一次离屏图层；
     * 卡片、输入框密集的弹层（如「档案填写」）滑动会明显掉帧，传 `false` 可只在这个弹层内
     * 回退成普通 RoundedCornerShape —— 布局、尺寸、颜色都不变，仅圆角曲率不同。
     */
    squircle: Boolean = true,
    content: @Composable () -> Unit,
) {
    BackHandler(show) { if (!busy) onDismiss() }
    OverlayBottomSheet(
        show = show,
        title = title,
        onDismissRequest = { if (!busy) onDismiss() },
        onDismissFinished = onDismissFinished,
        allowDismiss = !busy,
        cornerRadius = AppShape.sheet,
        sheetMaxWidth = AppSpace.contentWidth,
        insideMargin = DpSize(0.dp, 12.dp),
        backgroundColor = MiuixTheme.colorScheme.surface,
        content = {
            // 默认值就是 true，所以不传时这一层等于没有，其它弹层行为不变。
            CompositionLocalProvider(LocalSquircleEnabled provides squircle) {
                Box(Modifier.imePadding()) { content() }
            }
        },
    )
}
