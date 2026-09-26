package com.custodysim.app.ui.checkins

import androidx.core.content.edit
import androidx.compose.runtime.mutableLongStateOf
import android.Manifest
import android.content.Context
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.custodysim.app.data.checkin.firstCheckin
import com.custodysim.app.data.checkin.startsAt
import com.custodysim.app.data.checkin.endsAt
import com.custodysim.app.data.checkin.displayStatus
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import top.yukonga.miuix.kmp.preference.SwitchPreference

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.CardDefaults
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.res.stringResource
import com.custodysim.app.R
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.ScrollBehavior
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
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

/** formatter 只建一次：一行要格式化两三个时间，原来每次调用都重新解析模式串。 */
private val CHECKIN_TIME_FORMATTER = DateTimeFormatter.ofPattern("MM-dd HH:mm")

private fun formatCheckinTime(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
        .format(CHECKIN_TIME_FORMATTER)
}.getOrDefault(iso)

/** 点名页：当天时段列表 + 打卡 / 补卡。 */
@Composable
fun CheckinsScreen(container: AppContainer, scrollBehavior: ScrollBehavior) {
    val scope = rememberCoroutineScope()
    val snackbar = LocalAppSnackbar.current
    var slots by remember { mutableStateOf<List<CheckinSlot>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var notice by remember { mutableStateOf<String?>(null) }
    var action by remember { mutableStateOf<Action?>(null) }
    var sheetVisible by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val preferences = remember(context) { context.getSharedPreferences("checkin_preferences", Context.MODE_PRIVATE) }
    var gpsEnabled by remember { mutableStateOf(preferences.getBoolean("gps_enabled", false)) }
    fun saveGps(enabled: Boolean) {
        gpsEnabled = enabled
        preferences.edit { putBoolean("gps_enabled", enabled) }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val granted = container.locationCollector.hasForegroundPermission()
        saveGps(granted)
        if (!granted) snackbar("未获得定位权限，打卡继续使用 IP 定位")
    }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(slots, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                now = System.currentTimeMillis()
                val boundary = slots.flatMap { listOf(it.startsAt(), it.endsAt().let { end -> if (end == Long.MAX_VALUE) end else end + 1 }) }
                    .filter { it > now && it != Long.MAX_VALUE }.minOrNull()
                delay(if (boundary == null) 60_000L else (boundary - now).coerceIn(1L, 60_000L))
            }
        }
    }
    val next = remember(slots, now) { firstCheckin(slots, now) }
    val history = remember(slots, now) { slots.filter { it.status != "PENDING" || it.endsAt() < now }
        .sortedBy { it.startsAt() } }

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
        state = rememberAppListState(),
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = glassPagePadding(),
        verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
    ) {
        item {
            ListHeader(description = stringResource(R.string.checkins_hint),
                title = stringResource(R.string.today_checkins), loading = loading,
                onRefresh = { scope.launch { refresh() } })
        }
        if (slots.isNotEmpty()) item {
            val complete = slots.count { it.status in setOf("DONE", "COMPLETED", "ON_TIME", "LATE", "MAKEUP_APPROVED", "SYSTEM_MAKEUP", "EXEMPT") }
            Card(modifier = Modifier.fillMaxWidth(), cornerRadius = AppShape.group,
                insideMargin = PaddingValues(AppSpace.inset),
                colors = CardDefaults.defaultColors(color = MiuixTheme.colorScheme.primary.copy(alpha = 0.08f))) {
                Text("今日进度", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary)
                Spacer(Modifier.height(AppSpace.small))
                Text("$complete / ${slots.size} 项已完成", style = MiuixTheme.textStyles.title2)
                Spacer(Modifier.height(AppSpace.page))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                    listOf("待打卡" to slots.count { it.status == "PENDING" && it.endsAt() >= now },
                        "已完成" to complete, "需补卡" to slots.count { it.displayStatus(now) == "MISSED" && it.makeupId == null }).forEach { (label, count) ->
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(count.toString(), style = MiuixTheme.textStyles.title2, color = MiuixTheme.colorScheme.primary)
                            Text(label, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        }
                    }
                }
            }
        }
        when {
            loading && slots.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
            notice != null && slots.isEmpty() -> item {
                PageState(stringResource(R.string.load_failed), notice, onRetry = { scope.launch { refresh() } })
            }
            slots.isEmpty() -> item {
                PageState(stringResource(R.string.checkins_empty), stringResource(R.string.checkins_empty_hint))
            }
            else -> {
                if (next != null) item(key = "next-${next.taskId}") {
                    SettingGroup {
                        SlotRow(next, now) { mode -> action = Action(next, mode); sheetVisible = true }
                    }
                } else item(key = "no-next") { SettingGroup { InfoRow("暂无待进行的打卡", "今日已无即将开始或可进行的时段") } }
            }
        }
        item(key = "location-preference") {
            SettingGroup {
                SwitchPreference(title = "打卡 GPS 定位", checked = gpsEnabled,
                    summary = if (gpsEnabled) "所有打卡与补卡使用实时定位" else "使用 IP 定位",
                    onCheckedChange = { enabled ->
                        if (enabled && !container.locationCollector.hasForegroundPermission())
                            permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                        else saveGps(enabled)
                    })
            }
        }
        if (history.isNotEmpty()) {
            item(key = "history-heading") { SectionTitle("已过期与已完成") }
            itemsIndexed(history, key = { _, slot -> "history-${slot.taskId}" }, contentType = { _, _ -> "checkin" }) { _, slot ->
                SettingGroup { SlotRow(slot, now) { mode -> action = Action(slot, mode); sheetVisible = true } }
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
            gpsEnabled = gpsEnabled,
            onDismiss = { sheetVisible = false },
            onDismissFinished = { action = null },
            onDone = {
                sheetVisible = false
                snackbar(if (act.mode == Mode.MAKEUP) "补卡申请已提交" else "打卡成功")
                scope.launch { refresh() }
            },
        )
    }
}

/** 独立时段卡片，操作通过末尾按钮进入表单。 */
@Composable
private fun SlotRow(slot: CheckinSlot, now: Long, onAction: (Mode) -> Unit) {
    val status = slot.displayStatus(now)
    val upcoming = status == "PENDING" && now < slot.startsAt()
    val actionable = status == "PENDING" || (status == "MISSED" && slot.makeupId == null)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(AppSpace.inset),
        verticalArrangement = Arrangement.spacedBy(AppSpace.small),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                Text(slot.slotLabel ?: slot.ruleName, modifier = Modifier.weight(1f), style = MiuixTheme.textStyles.title2)
                StatusChip(if (upcoming) "即将开始" else if (status == "PENDING") "可打卡" else statusLabel(status), statusColor(status))
            }
            Column {
                Text(
                    slot.ruleName,
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    stringResource(R.string.checkin_schedule, formatCheckinTime(slot.scheduleAt), formatCheckinTime(slot.deadline)),
                    style = MiuixTheme.textStyles.body1,
                    color = MiuixTheme.colorScheme.primary,
                    modifier = Modifier.padding(vertical = AppSpace.small),
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
            if (actionable) {
                HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.10f))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    CompactAction(if (upcoming) "尚未开始" else stringResource(if (status == "PENDING") R.string.checkin_action else R.string.makeup_action),
                        enabled = !upcoming,
                        onClick = { onAction(if (status == "PENDING") Mode.CHECKIN else Mode.MAKEUP) })
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
    gpsEnabled: Boolean,
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
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val start = remember(slot.scheduleAt) { runCatching { OffsetDateTime.parse(slot.scheduleAt).toInstant().toEpochMilli() }.getOrNull() }
    val end = remember(slot.deadline) { runCatching { OffsetDateTime.parse(slot.deadline).toInstant().toEpochMilli() }.getOrNull() }
    val available = start != null && end != null && now in start..end
    LaunchedEffect(show) {
        while (show) { now = System.currentTimeMillis(); delay(1_000) }
    }
    val picker = rememberImagePicker(1) { urls -> photo = urls.firstOrNull() }

    OverlaySheet(
        show = show,
        title = stringResource(if (mode == Mode.CHECKIN) R.string.checkin_action else R.string.makeup_action),
        busy = busy,
        onDismiss = onDismiss,
        onDismissFinished = onDismissFinished,
    ) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(AppSpace.page)) {
            SettingGroup {
                InfoRow(slot.slotLabel ?: slot.ruleName, "${formatCheckinTime(slot.scheduleAt)} — ${formatCheckinTime(slot.deadline)}")
            }
            Spacer(Modifier.height(AppSpace.page))
            if (mode == Mode.MAKEUP) {
                FramedTextField(value = reason,
                    onValueChange = { reason = it },
                    label = stringResource(R.string.makeup_reason),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                FramedTextField(value = remark,
                    onValueChange = { remark = it },
                    label = if (slot.needRemark) "打卡备注（必填）" else stringResource(R.string.remark_optional),
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

            if (mode == Mode.CHECKIN) {
                Text(when {
                    start == null || end == null -> "时段信息异常，请刷新后重试"
                    now < start -> "尚未到打卡时间，时段开放后可提交"
                    now > end -> "本时段已截止，请返回刷新并按规则申请补卡"
                    else -> "当前可打卡"
                }, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                Spacer(Modifier.height(AppSpace.small))
            }

            PrimaryAction(
                text = stringResource(if (busy) R.string.submitting else R.string.submit),
                busy = busy,
                onClick = {
                    if (busy) return@PrimaryAction
                    scope.launch {
                        busy = true
                        error = null
                        try {
                        val currentTime = System.currentTimeMillis()
                        if (mode == Mode.CHECKIN && (start == null || end == null || currentTime !in start..end)) {
                            error = "当前不在可打卡时段，请返回刷新"
                            return@launch
                        }
                        val point = if (gpsEnabled) container.locationCollector.collectOnce(allowCached = false) else null
                        if (gpsEnabled && point == null) {
                            error = "无法获取实时定位，请检查权限和系统定位开关，或返回点名页关闭打卡 GPS 定位"
                            return@launch
                        }
                        val result = if (mode == Mode.CHECKIN) {
                            container.checkinRepository.checkin(slot.taskId, remark, photo, point)
                        } else {
                            container.checkinRepository.createMakeup(slot.taskId, reason, photo, point)
                        }
                        when (result) {
                            is ApiResult.Ok -> onDone()
                            is ApiResult.Err -> error = result.message
                        }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { error = "提交失败，请稍后重试" }
                        finally { busy = false }
                    }
                },
                enabled = !busy && (if (mode == Mode.MAKEUP) reason.trim().length >= 2
                    else available && (!slot.needRemark || remark.isNotBlank())),
            )
        }
    }
}
