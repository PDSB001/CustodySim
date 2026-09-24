package com.custodysim.app.ui.common

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.custodysim.app.R
import com.custodysim.app.ui.theme.AppSpace
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.YearMonth
import java.util.Locale
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.basic.ArrowRight
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Calendar values composed from Miuix's native wheel controls. Changes commit on confirm. */
@Composable
fun DatePreference(
    label: String,
    value: String,
    enabled: Boolean = true,
    includeTime: Boolean = false,
    monthOnly: Boolean = false,
    onValueChange: (String) -> Unit,
) {
    var show by remember { mutableStateOf(false) }
    val initial = remember(show, value) {
        runCatching {
            when {
                value.length == 7 -> YearMonth.parse(value).atDay(1).atStartOfDay()
                value.length == 10 -> LocalDate.parse(value).atStartOfDay()
                else -> LocalDateTime.parse(value)
            }
        }.getOrElse { LocalDateTime.now() }
    }
    var year by remember(show) { mutableIntStateOf(initial.year) }
    var month by remember(show) { mutableIntStateOf(initial.monthValue) }
    var day by remember(show) { mutableIntStateOf(initial.dayOfMonth) }
    var hour by remember(show) { mutableIntStateOf(initial.hour) }
    var minute by remember(show) { mutableIntStateOf(initial.minute) }
    val lastDay = YearMonth.of(year, month).lengthOfMonth()
    LaunchedEffect(lastDay) { day = day.coerceAtMost(lastDay) }
    SettingGroup {
        BasicComponent(title = label, summary = value.replace('T', ' ').ifBlank { "请选择" },
            enabled = enabled, onClick = { show = true },
            endActions = { Icon(MiuixIcons.Basic.ArrowRight, contentDescription = null) })
    }
    OverlayDialog(show = show, title = label, onDismissRequest = { show = false }) {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            Row(Modifier.fillMaxWidth()) {
                NumberPicker(year, { year = it }, Modifier.weight(1.3f), range = minOf(1900, initial.year)..maxOf(LocalDate.now().year + 100, initial.year), label = { "${it}年" }, visibleItemCount = 3, textStyle = MiuixTheme.textStyles.body1)
                NumberPicker(month, { month = it }, Modifier.weight(1f), range = 1..12, label = { "${it}月" }, visibleItemCount = 3, textStyle = MiuixTheme.textStyles.body1)
                if (!monthOnly) NumberPicker(day.coerceAtMost(lastDay), { day = it }, Modifier.weight(1f), range = 1..lastDay, label = { "${it}日" }, visibleItemCount = 3, textStyle = MiuixTheme.textStyles.body1)
            }
            if (includeTime) Row(Modifier.fillMaxWidth()) {
                NumberPicker(hour, { hour = it }, Modifier.weight(1f), range = 0..23, label = { "${it}时" }, visibleItemCount = 3)
                NumberPicker(minute, { minute = it }, Modifier.weight(1f), range = 0..59, label = { "${it}分" }, visibleItemCount = 3)
            }
            PrimaryAction("确定", onClick = {
                val date = String.format(Locale.US, "%04d-%02d", year, month) +
                    if (monthOnly) "" else String.format(Locale.US, "-%02d", day.coerceAtMost(lastDay))
                onValueChange(date + if (includeTime) String.format(Locale.US, "T%02d:%02d", hour, minute) else "")
                show = false
            })
            TextButton(text = stringResource(R.string.cancel), onClick = { show = false }, modifier = Modifier.fillMaxWidth())
        }
    }
}
