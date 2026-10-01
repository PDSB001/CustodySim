package com.custodysim.app.ui.applications

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.portal.PortalApplication
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import top.yukonga.miuix.kmp.basic.ScrollBehavior
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val APPLICATION_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

private fun formatApplicationTime(value: String): String = runCatching {
    OffsetDateTime.parse(value).atZoneSameInstant(ZoneId.of("Asia/Shanghai")).format(APPLICATION_TIME_FORMATTER)
}.getOrDefault(value.replace('T', ' ').take(16))

@Composable
fun ApplicationsScreen(container: AppContainer, scrollBehavior: ScrollBehavior) {
    var applications by remember { mutableStateOf<List<PortalApplication>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showForm by remember { mutableStateOf(false) }
    val draft = rememberFormDraft(container, "application")
    val formType = (draft.values["type"] as? Number)?.toInt()?.coerceIn(0, 2) ?: 0
    val reason = draft.values["reason"] as? String ?: ""
    val startAt = draft.values["start"] as? String ?: ""
    val endAt = draft.values["end"] as? String ?: ""
    var submitBusy by remember { mutableStateOf(false) }
    var clearAfterDismiss by remember { mutableStateOf(false) }
    var submitError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val snackbar = LocalAppSnackbar.current
    val typeLabels = listOf("一般事项申请", "请假申请", "临时离监申请")
    val typeValues = listOf("GENERAL", "LEAVE", "TEMPORARY_OUT_OF_CUSTODY")

    fun updateDraft(field: String, value: Any) {
        draft.set(field, value)
        submitError = null
    }

    fun refresh() {
        scope.launch {
            loading = true
            error = null
            try {
                when (val result = container.portalRepository.applications()) {
                    is ApiResult.Ok -> applications = result.data
                    is ApiResult.Err -> error = result.message
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { error = "无法加载申请，请稍后重试" }
            finally { loading = false }
        }
    }
    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        state = rememberAppListState(),
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = glassPagePadding(),
        verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
    ) {
        item {
            ListHeader(stringResource(R.string.portal_applications_hint), stringResource(R.string.portal_application_list), loading, ::refresh)
        }
        item {
            TextButton(text = stringResource(R.string.application_new), onClick = { submitError = null; showForm = true }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.textButtonColorsPrimary())
        }
        if (applications.isNotEmpty()) error?.let { item { NoticeBanner(it, error = true) } }
        when {
            loading && applications.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
            error != null && applications.isEmpty() -> item { PageState(stringResource(R.string.load_failed), error, onRetry = ::refresh) }
            applications.isEmpty() -> item { PageState(stringResource(R.string.portal_empty_applications), "点击上方“发起申请”，填写事由并提交审核") }
            else -> items(applications, key = { it.id }, contentType = { "application" }) { application ->
                SettingGroup(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(AppSpace.inset), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                        Text(application.title, style = MiuixTheme.textStyles.body1)
                        StatusChip(when (application.status) {
                            "PENDING" -> "待审核"
                            "PENDING_REVIEW" -> "审核中"
                            "RETURNED" -> "已退回"
                            "DRAFT" -> "草稿"
                            "APPROVED" -> "已批准"
                            "REJECTED" -> "已驳回"
                            "CANCELLED" -> "已撤销"
                            else -> application.status
                        }, statusColor(if (application.status == "PENDING_REVIEW") "SUBMITTED" else application.status))
                        Text(application.reason, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        application.submittedAt?.let { Text("提交于 ${formatApplicationTime(it)}", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary) }
                    }
                }
            }
        }
    }
    OverlaySheet(show = showForm, title = stringResource(R.string.application_new),
        onDismiss = { if (!submitBusy) showForm = false }, busy = submitBusy,
        onDismissFinished = {
            if (clearAfterDismiss) {
                draft.clear(); clearAfterDismiss = false
            }
        }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(AppSpace.page), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            draft.error?.let { NoticeBanner(it, error = true) }
            SettingGroup { OverlayDropdownPreference(
                title = stringResource(R.string.application_type),
                items = typeLabels,
                selectedIndex = formType,
                enabled = !submitBusy && draft.ready,
                onSelectedIndexChange = { updateDraft("type", it) },
                modifier = Modifier.fillMaxWidth(),
            ) }
            FramedTextField(value = reason, onValueChange = { updateDraft("reason", it) }, label = stringResource(R.string.application_reason), minLines = 3, enabled = !submitBusy && draft.ready, modifier = Modifier.fillMaxWidth())
            if (formType != 0) {
                DatePreference(stringResource(R.string.application_start), startAt, !submitBusy && draft.ready, includeTime = true) { updateDraft("start", it) }
                DatePreference(stringResource(R.string.application_end), endAt, !submitBusy && draft.ready, includeTime = true) { updateDraft("end", it) }
            }
            submitError?.let { NoticeBanner(it, error = true) }
            PrimaryAction(text = stringResource(if (submitBusy) R.string.submitting else R.string.application_submit), busy = submitBusy, enabled = draft.ready, onClick = {
                if (submitBusy || !draft.ready) return@PrimaryAction
                if (reason.isBlank()) { submitError = "请填写申请事由"; return@PrimaryAction }
                if (reason.trim().length > 2000) { submitError = "申请事由不能超过 2000 字"; return@PrimaryAction }
                if (formType != 0) {
                    val start = runCatching { LocalDateTime.parse(startAt) }.getOrNull()
                    val end = runCatching { LocalDateTime.parse(endAt) }.getOrNull()
                    if (start == null || end == null) { submitError = "请选择完整的起止时间"; return@PrimaryAction }
                    if (!end.isAfter(start)) { submitError = "结束时间必须晚于开始时间"; return@PrimaryAction }
                }
                submitBusy = true
                submitError = null
                scope.launch {
                    try {
                        val result = container.portalRepository.submitApplication(typeValues[formType], reason.trim(), startAt.ifBlank { null }, endAt.ifBlank { null })
                        when (result) {
                            is ApiResult.Ok -> { draft.submitted(); clearAfterDismiss = true; showForm = false; snackbar("申请已提交"); refresh() }
                            is ApiResult.Err -> submitError = result.message
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { submitError = "提交失败，请稍后重试" }
                    finally { submitBusy = false }
                }
            })
        }
    }
}
