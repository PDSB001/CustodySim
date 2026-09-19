package com.custodysim.app.ui.common

import androidx.compose.runtime.Composable
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.custodysim.app.R
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Close
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
        startAction = {
            IconButton(
                onClick = onDismiss,
                enabled = !busy,
                minWidth = 40.dp,
                minHeight = 40.dp,
                backgroundColor = MiuixTheme.colorScheme.primary.copy(alpha = 0.10f),
            ) {
                Icon(MiuixIcons.Close, contentDescription = stringResource(R.string.close),
                    tint = MiuixTheme.colorScheme.primary)
            }
        },
        content = {
            Box(Modifier.imePadding()) { content() }
        },
    )
}
