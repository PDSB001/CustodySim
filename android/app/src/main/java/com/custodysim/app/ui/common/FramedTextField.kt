package com.custodysim.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import com.custodysim.app.ui.theme.AppShape
import top.yukonga.miuix.kmp.squircle.LocalSquircleEnabled
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** A visible resting outline around the native Miuix field; focus uses Miuix's own border. */
@Composable
fun FramedTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "",
    enabled: Boolean = true,
    singleLine: Boolean = false,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    minLines: Int = 1,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    CompositionLocalProvider(
        // 弹层可以整体关掉 squircle（见 OverlaySheet 的 squircle 参数），但输入框只用到
        // squircleBackground / squircleBorder —— 纯 shader 描边，不像 Card 那样还要合成离屏图层，
        // 开销小得多；而关掉之后底色与描边的观感和原来不一致，所以这里显式恢复原有渲染。
        LocalSquircleEnabled provides true,
    ) {
        MiuixTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier.border(
                BorderStroke(if (focused) 0.dp else 1.dp,
                    MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.38f)),
                RoundedCornerShape(AppShape.field),
            ),
            label = label,
            enabled = enabled,
            singleLine = singleLine,
            maxLines = maxLines,
            minLines = minLines,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            interactionSource = interactionSource,
            colors = softTextFieldColors(),
            cornerRadius = AppShape.field,
        )
    }
}
