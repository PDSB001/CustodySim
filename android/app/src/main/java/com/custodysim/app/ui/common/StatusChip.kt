package com.custodysim.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.basic.Check
import top.yukonga.miuix.kmp.icon.basic.Close
import top.yukonga.miuix.kmp.theme.MiuixTheme
import com.custodysim.app.ui.theme.AppColors
import com.custodysim.app.ui.theme.LocalDarkTheme

/**
 * 补充语义色：MiuiX 主题色板只有 primary/error 等，没有 success/warning，
 * 这里补充「成功绿」「警告橙」两个语义色，其余一律走主题色。
 */

/**
 * 业务状态 → 状态色。优先级：主题色优先，只有主题缺失的语义才用补充色。
 */
@Composable
fun statusColor(status: String): Color = when (status) {
    "PENDING" -> MiuixTheme.colorScheme.primary
    "MISSED", "RETURNED", "EXPIRED", "REJECTED", "MAKEUP_REJECTED" -> MiuixTheme.colorScheme.error
    "DONE", "COMPLETED", "APPROVED", "MAKEUP_APPROVED", "SYSTEM_MAKEUP", "ON_TIME" -> AppColors.success
    "SUBMITTED", "MAKEUP", "MAKEUP_PENDING", "LATE" -> AppColors.warning
    else -> MiuixTheme.colorScheme.onSurfaceVariantSummary
}

/**
 * 成功与异常使用色相分开的实色底色及高对比文字，避免淡透明底色混淆。
 * 其余状态保留轻量胶囊样式。
 */
@Composable
fun StatusChip(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val scheme = MiuixTheme.colorScheme
    val success = color == AppColors.success
    val failure = color == scheme.error
    val dark = LocalDarkTheme.current
    val icon = when {
        success -> MiuixIcons.Basic.Check
        failure -> MiuixIcons.Basic.Close
        else -> null
    }
    val background = when {
        success -> if (dark) Color(0xFF45E0B2) else Color(0xFF007A5A)
        failure -> if (dark) Color(0xFFFF7D8C) else Color(0xFFC81E3A)
        else -> color.copy(alpha = 0.14f)
    }
    val foreground = when {
        success -> if (dark) Color(0xFF07352A) else Color.White
        failure -> if (dark) Color(0xFF380713) else Color.White
        else -> color
    }
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(background)
            .then(if (icon != null) Modifier.border(0.75.dp, color.copy(alpha = 0.32f), CircleShape) else Modifier)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = foreground)
        Text(
            text,
            color = foreground,
            style = if (icon != null) MiuixTheme.textStyles.footnote2.copy(fontWeight = FontWeight.Medium)
                else MiuixTheme.textStyles.footnote2,
        )
    }
}
