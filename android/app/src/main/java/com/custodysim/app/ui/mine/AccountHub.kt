package com.custodysim.app.ui.mine

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import android.app.DatePickerDialog
import java.util.Calendar
import java.util.Locale
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.portal.*
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Info
import top.yukonga.miuix.kmp.theme.MiuixTheme
import androidx.compose.ui.res.stringResource
import android.widget.Toast

private enum class HubPanel(val title: Int) {
    ARCHIVES(R.string.portal_archives)
}

private fun statusLabel(status: String): String = when (status) {
    "DRAFT" -> "草稿"
    "PENDING_REVIEW" -> "会签中"
    "RETURNED" -> "已退回"
    "LOCKED" -> "已归档"
    else -> status.ifBlank { "未知状态" }
}

@Composable
fun AccountHub(container: AppContainer, allowEditing: Boolean = true) {
    val context = LocalContext.current
    var panel by remember { mutableStateOf<HubPanel?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var archives by remember { mutableStateOf<List<ProfileRecord>>(emptyList()) }
    var showForms by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun open(target: HubPanel) {
        panel = target
        loading = true
        error = null
        scope.launch {
            when (target) {
                HubPanel.ARCHIVES -> when (val r = container.portalRepository.profileRecords()) {
                    is ApiResult.Ok -> archives = r.data
                    is ApiResult.Err -> error = r.message
                }
            }
            loading = false
        }
    }

    SettingGroup {
        if (allowEditing) HubRow("档案填写") { showForms = true }
        HubRow(stringResource(R.string.portal_archives)) { open(HubPanel.ARCHIVES) }
    }

    OverlaySheet(show = panel != null, title = stringResource(panel?.title ?: R.string.portal_notices), onDismiss = { panel = null }) {
        when {
            loading -> PageState(stringResource(R.string.loading), loading = true)
            error != null -> PageState(stringResource(R.string.load_failed), error)
            archives.isEmpty() -> PageState(stringResource(R.string.portal_empty_archives))
            else -> LazyColumn(contentPadding = PaddingValues(AppSpace.page), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                items(archives) { item ->
                    SettingGroup(modifier = Modifier.padding(horizontal = AppSpace.page)) {
                        // 用 Column 统一内边距与行间距，避免相邻的整宽按钮彼此紧贴。
                        Column(
                            Modifier.fillMaxWidth().padding(AppSpace.inset),
                            verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
                        ) {
                            Text(item.userName.ifBlank { "未填写" }, style = MiuixTheme.textStyles.body1)
                            Text(item.formName, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            Text(
                                buildString {
                                    append(statusLabel(item.status))
                                    item.code?.let { append(" · 编号 ").append(it) }
                                    item.boxName?.let { append(" · 档案盒 ").append(it) }
                                },
                                color = if (item.status == "LOCKED") MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                            item.lockedAt?.let { Text("归档于 $it", color = MiuixTheme.colorScheme.onSurfaceVariantSummary) }

                            // 与 Web 端卷宗一致：证件照、电子签名、公章都要能看到图片本身
                            item.photoData?.let { ArchiveImage("证件照", it, ContentScale.Crop) }
                            item.signatureData?.let { ArchiveImage("电子签名", it, ContentScale.Fit) }
                            item.officialSealData?.let { ArchiveImage("公章", it, ContentScale.Fit) }

                            val summary = item.fields.mapNotNull { field ->
                                item.data.optString(field.name).takeIf { it.isNotBlank() && it != "null" }?.let { "${field.name}：$it" }
                            }.joinToString("\n")
                            if (summary.isNotBlank()) Text(summary, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            TextButton(
                                text = stringResource(R.string.archive_identity_image),
                                onClick = {
                                    val uri = ProfileImageGenerator.saveIdentityPng(context, item)
                                    Toast.makeText(context, if (uri != null) R.string.archive_exported else R.string.archive_export_failed, Toast.LENGTH_SHORT).show()
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = AppSpace.small),
                                colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                            TextButton(
                                text = stringResource(R.string.archive_export_image),
                                onClick = {
                                    val uri = ProfileImageGenerator.saveArchivePng(context, item)
                                    Toast.makeText(context, if (uri != null) R.string.archive_exported else R.string.archive_export_failed, Toast.LENGTH_SHORT).show()
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = AppSpace.small),
                                colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                        }
                    }
                }
            }
        }
    }
    ProfileFormsSheet(container, showForms) { showForms = false }
}

/** Notification sheet opened from the Home top app bar. */
@Composable
fun NoticeSheet(container: AppContainer, show: Boolean, onDismiss: () -> Unit) {
    var loading by remember(show) { mutableStateOf(show) }
    var error by remember { mutableStateOf<String?>(null) }
    var notices by remember { mutableStateOf<List<PortalNotice>>(emptyList()) }
    var markingId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(show) {
        if (!show) return@LaunchedEffect
        loading = true
        error = null
        when (val result = container.portalRepository.notices()) {
            is ApiResult.Ok -> notices = result.data
            is ApiResult.Err -> error = result.message
        }
        loading = false
    }
    OverlaySheet(show = show, title = stringResource(R.string.portal_notices), onDismiss = onDismiss) {
        when {
            loading -> PageState(stringResource(R.string.loading), loading = true)
            error != null -> PageState(stringResource(R.string.load_failed), error)
            notices.isEmpty() -> PageState(stringResource(R.string.portal_empty_notices))
            else -> LazyColumn(
                contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
            ) {
                items(notices) { item ->
                    SettingGroup {
                        Row(
                            Modifier.fillMaxWidth().padding(AppSpace.inset),
                            horizontalArrangement = Arrangement.spacedBy(AppSpace.medium),
                            verticalAlignment = androidx.compose.ui.Alignment.Top,
                        ) {
                            Icon(MiuixIcons.Info, contentDescription = stringResource(R.string.portal_notices), tint = MiuixTheme.colorScheme.primary)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    Text(item.title, style = MiuixTheme.textStyles.body1)
                                    Text(
                                        stringResource(if (item.read) R.string.portal_read else R.string.portal_unread),
                                        color = if (item.read) MiuixTheme.colorScheme.onSurfaceVariantSummary else MiuixTheme.colorScheme.primary,
                                        style = MiuixTheme.textStyles.footnote1,
                                    )
                                }
                                HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.22f))
                                Text(item.content, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                if (!item.read) {
                                    TextButton(
                                        text = stringResource(R.string.portal_mark_read),
                                        enabled = markingId == null,
                                        onClick = {
                                            markingId = item.id
                                            scope.launch {
                                                when (container.portalRepository.markNoticeRead(item.id)) {
                                                    is ApiResult.Ok -> notices = notices.map { notice -> if (notice.id == item.id) notice.copy(read = true) else notice }
                                                    is ApiResult.Err -> Unit
                                                }
                                                markingId = null
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = ButtonDefaults.textButtonColorsPrimary(),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileFormsSheet(container: AppContainer, show: Boolean, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var forms by remember(show) { mutableStateOf<List<ProfileForm>>(emptyList()) }
    var records by remember(show) { mutableStateOf<List<ProfileRecord>>(emptyList()) }
    var selectedIndex by remember(show) { mutableIntStateOf(0) }
    var values by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var photo by remember { mutableStateOf<String?>(null) }
    var loading by remember(show) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val photoPicker = rememberImagePicker(1) { urls -> photo = urls.firstOrNull() }
    val selectedForm = forms.getOrNull(selectedIndex)
    val selectedRecord = selectedForm?.let { form -> records.firstOrNull { it.formId == form.id } }
    val editable = selectedRecord == null || selectedRecord.status == "DRAFT" || selectedRecord.status == "RETURNED"
    LaunchedEffect(show) {
        if (!show) return@LaunchedEffect
        loading = true; error = null
        val formResult = container.portalRepository.profileForms()
        val recordResult = container.portalRepository.profileRecords()
        if (formResult is ApiResult.Ok) forms = formResult.data else if (formResult is ApiResult.Err) error = formResult.message
        if (recordResult is ApiResult.Ok) records = recordResult.data else if (recordResult is ApiResult.Err) error = recordResult.message
        loading = false
    }
    LaunchedEffect(show, selectedForm?.id, selectedRecord?.id) {
        selectedForm?.let { form ->
            values = form.fields.associate { field -> field.name to (selectedRecord?.data?.optString(field.name)?.takeIf { it != "null" } ?: "") }
            photo = selectedRecord?.photoData
        }
    }
    OverlaySheet(show = show, title = "档案填写", onDismiss = onDismiss, busy = busy) {
        when {
            loading -> PageState(stringResource(R.string.loading), loading = true)
            error != null && forms.isEmpty() -> PageState(stringResource(R.string.load_failed), error)
            forms.isEmpty() -> PageState("暂无可填写档案")
            selectedForm == null -> PageState("暂无可填写档案")
            else -> LazyColumn(
                // Keep the sheet within the viewport so long forms can scroll.
                modifier = Modifier.fillMaxWidth().fillMaxHeight(0.82f),
                contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
            ) {
                item {
                    OverlayDropdownPreference(
                        title = "档案分卷", summary = selectedForm.name, items = forms.map { it.name }, selectedIndex = selectedIndex,
                        enabled = !busy, onSelectedIndexChange = { selectedIndex = it }, modifier = Modifier.fillMaxWidth(),
                    )
                }
                selectedForm.content?.takeIf { it.isNotBlank() }?.let { description ->
                    item { Text(description, color = MiuixTheme.colorScheme.onSurfaceVariantSummary) }
                }
                if (selectedRecord != null && !editable) {
                    item {
                        Text(
                            "当前档案为${statusLabel(selectedRecord.status)}，暂不可修改",
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        )
                    }
                }
                // 证件照：导出身份牌 / 档案图片时会用到，与 Web 端一致
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                        ArchiveImage("证件照", photo, ContentScale.Crop)
                        if (editable) {
                            TextButton(
                                text = stringResource(if (photo != null) R.string.change_photo else R.string.add_photo),
                                enabled = !busy,
                                onClick = photoPicker,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                            if (photo != null) TextButton(
                                text = "移除照片",
                                enabled = !busy,
                                onClick = { photo = null },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                items(selectedForm.fields, key = { it.name }) { field ->
                    val value = values[field.name].orEmpty()
                    when (field.type) {
                        "SELECT" -> OverlayDropdownPreference(
                            title = field.name, summary = value.ifBlank { "请选择" }, items = listOf("请选择") + field.options,
                            selectedIndex = (field.options.indexOf(value) + 1).coerceAtLeast(0), enabled = !busy && editable,
                            onSelectedIndexChange = { index -> values = values + (field.name to if (index == 0) "" else field.options[index - 1]) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        "DATE" -> TextButton(
                            text = if (value.isBlank()) field.name else "${field.name}：$value", enabled = !busy && editable,
                            onClick = {
                                val now = Calendar.getInstance()
                                DatePickerDialog(context, { _, year, month, day ->
                                    val formatted = if (field.name == "出生年月") {
                                        String.format(Locale.US, "%04d-%02d", year, month + 1)
                                    } else {
                                        String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day)
                                    }
                                    values = values + (field.name to formatted)
                                }, now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH)).show()
                            }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.textButtonColorsPrimary(),
                        )
                        else -> TextField(value = value, onValueChange = { values = values + (field.name to it) }, label = field.name, enabled = !busy && editable, modifier = Modifier.fillMaxWidth())
                    }
                }
                // 电子签名与公章：与 Web 端一样只做展示，公章由管理处加盖
                item {
                    ArchiveImage(
                        "电子签名",
                        selectedRecord?.signatureData,
                        ContentScale.Fit,
                        emptyText = "保存后由系统生成",
                    )
                }
                item {
                    ArchiveImage(
                        "公章",
                        selectedRecord?.officialSealData,
                        ContentScale.Fit,
                        emptyText = "管理处最终审批后加盖公章",
                    )
                }
                item {
                    // 一个 lazy item 里平铺多个根节点会互相重叠，按钮统一放进 Column 排列。
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                        PrimaryAction("保存草稿", enabled = !busy && editable, onClick = {
                            scope.launch {
                                busy = true; error = null
                                val data = org.json.JSONObject().apply { values.forEach { (key, value) -> put(key, value) } }
                                when (val result = container.portalRepository.saveProfileRecord(selectedForm.id, data, photo)) {
                                    is ApiResult.Ok -> Toast.makeText(context, "草稿已保存", Toast.LENGTH_SHORT).show()
                                    is ApiResult.Err -> error = result.message
                                }
                                busy = false
                            }
                        })
                        selectedRecord?.let { record ->
                            if (record.status == "DRAFT" || record.status == "RETURNED") TextButton(
                                text = "提交会签", enabled = !busy, onClick = {
                                    scope.launch {
                                        busy = true
                                        when (val result = container.portalRepository.submitProfileRecord(record.id)) {
                                            is ApiResult.Ok -> { Toast.makeText(context, "档案已提交会签", Toast.LENGTH_SHORT).show(); onDismiss() }
                                            is ApiResult.Err -> error = result.message
                                        }
                                        busy = false
                                    }
                                }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                        }
                        error?.let { Text(it, color = MiuixTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
}

/** 档案卷宗里的一张图片：证件照 / 电子签名 / 公章。传 null 时显示 [emptyText]。 */
@Composable
private fun ArchiveImage(
    label: String,
    dataUrl: String?,
    contentScale: ContentScale,
    emptyText: String = "未上传",
) {
    val bitmap = rememberDataUrlImage(dataUrl)
    Column(verticalArrangement = Arrangement.spacedBy(AppSpace.tiny)) {
        Text(label, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        when {
            bitmap != null -> Image(
                bitmap = bitmap,
                contentDescription = label,
                modifier = Modifier.size(112.dp).clip(RoundedCornerShape(AppShape.thumbnail)),
                contentScale = contentScale,
            )
            dataUrl == null -> Text(
                emptyText,
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
            else -> Text(
                stringResource(R.string.image_unavailable),
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
    }
}

@Composable
private fun HubRow(label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(AppSpace.inset)) {
        Text(label, style = MiuixTheme.textStyles.body1)
    }
}
