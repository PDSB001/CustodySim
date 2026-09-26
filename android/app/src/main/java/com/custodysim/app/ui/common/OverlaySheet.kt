package com.custodysim.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
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
    squircle: Boolean = false,
    /**
     * 内容区固定高度（屏幕可用高度的比例）；不传则按内容自适应。
     *
     * 需要加载的重内容弹层应传值：加载提示和结果（长列表 / 长表单）高度差很多，按内容自适应时
     * 数据一到弹层就会突然长高 —— 看起来像动画跃进。固定后弹层从打开起就是最终高度，只换内容。
     * 内容要占满这块区域时自行加 `Modifier.fillMaxSize()`，短内容（加载 / 空态）默认垂直居中。
     */
    bodyFraction: Float? = null,
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
        // Unblurred transparency exposes readable text from the page underneath. Keep this
        // opaque until backdrop sampling can follow Miuix's internal sheet translation.
        backgroundColor = MiuixTheme.colorScheme.surface,
        content = {
            // Prefer Miuix's rounded fallback for moving, scrollable sheet content.
            CompositionLocalProvider(LocalSquircleEnabled provides squircle) {
                Box(Modifier.imePadding().navigationBarsPadding()) {
                    if (bodyFraction == null) content()
                    else Box(
                        modifier = Modifier.fillMaxWidth().fillMaxHeight(bodyFraction),
                        contentAlignment = Alignment.Center,
                    ) { content() }
                }
            }
        },
    )
}
