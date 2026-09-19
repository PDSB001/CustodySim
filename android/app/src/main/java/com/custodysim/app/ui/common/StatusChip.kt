package com.custodysim.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import com.custodysim.app.ui.theme.AppColors

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
 * 状态标签：低透明度底色 + 同色文字的小圆角胶囊。
 */
@Composable
fun StatusChip(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Text(
            text,
            color = color,
            style = MiuixTheme.textStyles.footnote2,
        )
    }
}
