package com.custodysim.app.ui.checkins

import androidx.compose.foundation.clickable
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.res.stringResource
import com.custodysim.app.R
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.checkin.CheckinSlot
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.ImageThumbs
import com.custodysim.app.ui.common.OverlaySheet
import com.custodysim.app.ui.common.rememberImagePicker
import com.custodysim.app.ui.common.statusColor
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.ScrollBehavior
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.theme.MiuixTheme
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

enum class Mode { CHECKIN, MAKEUP }

private data class Action(val slot: CheckinSlot, val mode: Mode)

private val STATUS_LABEL = mapOf(
    "PENDING" to R.string.checkin_pending, "DONE" to R.string.checkin_done,
    "MISSED" to R.string.checkin_missed, "MAKEUP" to R.string.checkin_makeup,
    "EXEMPT" to R.string.checkin_exempt,
    "COMPLETED" to R.string.checkin_done, "LATE" to R.string.checkin_late,
    "MAKEUP_PENDING" to R.string.checkin_makeup_pending,
    "MAKEUP_APPROVED" to R.string.checkin_makeup_approved,
    "MAKEUP_REJECTED" to R.string.checkin_makeup_rejected,
    "SYSTEM_MAKEUP" to R.string.checkin_system_makeup,
    "ON_TIME" to R.string.checkin_on_time,
    "APPROVED" to R.string.makeup_approved, "REJECTED" to R.string.makeup_rejected,
)
@Composable
private fun statusLabel(status: String): String = STATUS_LABEL[status]?.let { stringResource(it) } ?: status

@Composable
private fun makeupStatusLabel(status: String): String = when (status) {
    "PENDING" -> stringResource(R.string.makeup_pending)
    "APPROVED" -> stringResource(R.string.makeup_approved)
    "REJECTED" -> stringResource(R.string.makeup_rejected)
    else -> status
}

private fun formatCheckinTime(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("MM-dd HH:mm"))
}.getOrDefault(iso)

/** 点名页：当天时段列表 + 打卡 / 补卡。 */
@Composable
fun CheckinsScreen(container: AppContainer, scrollBehavior: ScrollBehavior) {
    val scope = rememberCoroutineScope()
    var slots by remember { mutableStateOf<List<CheckinSlot>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var notice by remember { mutableStateOf<String?>(null) }
    var action by remember { mutableStateOf<Action?>(null) }
    var sheetVisible by remember { mutableStateOf(false) }

    suspend fun refresh() {
        loading = true
        when (val result = container.checkinRepository.fetchToday()) {
            is ApiResult.Ok -> { slots = result.data; notice = null }
            is ApiResult.Err -> notice = result.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = PaddingValues(AppSpace.page),
    ) {
        item {
            ListHeader(description = stringResource(R.string.checkins_hint),
                title = stringResource(R.string.today_checkins), loading = loading,
                onRefresh = { scope.launch { refresh() } })
        }
        when {
            loading && slots.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
            notice != null && slots.isEmpty() -> item {
                PageState(stringResource(R.string.load_failed), notice, onRetry = { scope.launch { refresh() } })
            }
            slots.isEmpty() -> item {
                PageState(stringResource(R.string.checkins_empty), stringResource(R.string.checkins_empty_hint))
            }
            else -> itemsIndexed(slots, key = { _, slot -> slot.taskId }) { index, slot ->
                AnimatedVisibility(visible = true,
                    enter = fadeIn(tween(260, delayMillis = index * 35)) +
                        slideInVertically(tween(260, delayMillis = index * 35)) { it / 10 }) {
                    GroupedListItem(first = index == 0, last = index == slots.lastIndex) {
                        SlotRow(slot) { mode -> action = Action(slot, mode); sheetVisible = true }
                    }
                }
            }
        }
        if (slots.isNotEmpty()) notice?.let { item { NoticeBanner(it, error = true) } }
    }

    action?.let { act ->
        CheckinSheet(
            slot = act.slot,
            show = sheetVisible,
            mode = act.mode,
            container = container,
            onDismiss = { sheetVisible = false },
            onDismissFinished = { action = null },
            onDone = {
                sheetVisible = false
                scope.launch { refresh() }
            },
        )
    }
}

/** 分组列表中的一个时段行；待打卡 / 可补卡的行整行可点。 */
@Composable
private fun SlotRow(slot: CheckinSlot, onAction: (Mode) -> Unit) {
    val actionable = slot.status == "PENDING" || (slot.status == "MISSED" && slot.makeupId == null)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (actionable) {
                    Modifier.clickable {
                        onAction(if (slot.status == "PENDING") Mode.CHECKIN else Mode.MAKEUP)
                    }
                } else {
                    Modifier
                }
            )
            .padding(AppSpace.inset),
        verticalArrangement = Arrangement.spacedBy(AppSpace.small),
    ) {
        RecordContent(
            actionLabel = if (actionable) stringResource(if (slot.status == "PENDING") R.string.checkin_action else R.string.makeup_action) else null,
            onAction = { onAction(if (slot.status == "PENDING") Mode.CHECKIN else Mode.MAKEUP) },
        ) {
            StatusChip(statusLabel(slot.status), statusColor(slot.status))
            Column {
                Text(slot.slotLabel ?: slot.ruleName, style = MiuixTheme.textStyles.body1)
                Text(
                    slot.ruleName,
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    stringResource(R.string.checkin_schedule, formatCheckinTime(slot.scheduleAt), formatCheckinTime(slot.deadline)),
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.primary,
                )
                slot.checkinAt?.let {
                    Text(
                        stringResource(R.string.checkin_actual_time, formatCheckinTime(it)),
                        style = MiuixTheme.textStyles.footnote1,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                }
                slot.remark?.let {
                    Text(it, style = MiuixTheme.textStyles.footnote1, modifier = Modifier.padding(top = 4.dp))
                }
                slot.recordPhotoUrl?.let {
                    ImageThumbs(listOf(it), Modifier.padding(top = 8.dp))
                }
                if (slot.makeupId != null) {
                    Text(
                        stringResource(R.string.makeup_status, makeupStatusLabel(slot.makeupStatus ?: "")),
                        style = MiuixTheme.textStyles.footnote1,
                        color = statusColor(slot.makeupStatus ?: "MAKEUP"),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    slot.makeupReason?.let {
                        Text(it, style = MiuixTheme.textStyles.footnote1, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}

/** 打卡/补卡的下拉表单。 */
@Composable
private fun CheckinSheet(
    slot: CheckinSlot,
    show: Boolean,
    mode: Mode,
    container: AppContainer,
    onDismiss: () -> Unit,
    onDismissFinished: () -> Unit,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var remark by remember { mutableStateOf("") }
    var photo by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val picker = rememberImagePicker(1) { urls -> photo = urls.firstOrNull() }

    OverlaySheet(
        show = show,
        title = stringResource(if (mode == Mode.CHECKIN) R.string.checkin_action else R.string.makeup_action),
        busy = busy,
        onDismiss = onDismiss,
        onDismissFinished = onDismissFinished,
    ) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(AppSpace.page)) {
            if (mode == Mode.MAKEUP) {
                TextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = stringResource(R.string.makeup_reason),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                TextField(
                    value = remark,
                    onValueChange = { remark = it },
                    label = stringResource(R.string.remark_optional),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(12.dp))

            val current = photo
            if (current != null) {
                ImageThumbs(listOf(current), Modifier.padding(top = AppSpace.tiny), onRemove = if (busy) null else { _ -> photo = null })
                Spacer(Modifier.height(8.dp))
                TextButton(
                    text = stringResource(R.string.change_photo),
                    enabled = !busy,
                    onClick = picker,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColorsPrimary(),
                )
            } else {
                TextButton(
                    text = stringResource(R.string.add_photo),
                    enabled = !busy,
                    onClick = picker,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColorsPrimary(),
                )
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.error)
            }
            Spacer(Modifier.height(16.dp))

            PrimaryAction(
                text = stringResource(if (busy) R.string.submitting else R.string.submit),
                busy = busy,
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        val point = container.locationCollector.collectOnce()
                        val result = if (mode == Mode.CHECKIN) {
                            container.checkinRepository.checkin(slot.taskId, remark, photo, point)
                        } else {
                            container.checkinRepository.createMakeup(slot.taskId, reason, photo, point)
                        }
                        when (result) {
                            is ApiResult.Ok -> onDone()
                            is ApiResult.Err -> error = result.message
                        }
                        busy = false
                    }
                },
                enabled = !busy && (mode != Mode.MAKEUP || reason.trim().length >= 2),
            )
        }
    }
}
