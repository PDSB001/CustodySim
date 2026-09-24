package com.custodysim.app.ui.mine
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.Alignment
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.portal.*
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.BasicComponent
import top.yukonga.miuix.kmp.icon.basic.ArrowRight
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Promotions
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
    // 身份牌/档案图片上的人员信息（编号、所在监室、管理等级）。
    var summary by remember { mutableStateOf<ProfileSummary?>(null) }
    var showForms by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var exportedUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var previewLoading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun open(target: HubPanel) {
        panel = target
        loading = true
        error = null
        scope.launch {
            when (target) {
                HubPanel.ARCHIVES -> {
                    when (val r = container.portalRepository.profileRecords()) {
                        is ApiResult.Ok -> archives = r.data
                        is ApiResult.Err -> error = r.message
                    }
                    // 身份牌/档案图片要展示编号、所在监室、管理等级；该接口只允许被监管人查本人
                    // （allowEditing 即「本人」），其它角色会拿到 403 —— 取不到就不带，图片退回记录自带字段。
                    if (allowEditing) {
                        when (val r = container.portalRepository.profileSummary()) {
                            is ApiResult.Ok -> summary = r.data
                            is ApiResult.Err -> Unit
                        }
                    }
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
                    SettingGroup {
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

                            // 字段解析只在档案数据变化时做一次：导出中/预览等状态一变，整张卡片都会重组。
                            val fieldRows = remember(item) {
                                item.fields.mapNotNull { field ->
                                    item.data.optString(field.name).takeIf { it.isNotBlank() && it != "null" }
                                        ?.let { field.name to it }
                                }
                            }
                            fieldRows.forEach { (label, value) ->
                                HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
                                if (value.startsWith("data:image/")) ArchiveImage(label, value, ContentScale.Fit)
                                else BasicComponent(title = label, summary = value,
                                    insideMargin = PaddingValues(vertical = AppSpace.small))
                            }
                            SectionTitle("导出图片")
                            TextButton(
                                text = stringResource(R.string.archive_identity_image),
                                enabled = !exporting,
                                onClick = {
                                    scope.launch {
                                        exporting = true
                                        try {
                                            exportedUri = withContext(Dispatchers.IO) { runCatching { ProfileImageGenerator.saveIdentityPng(context, item, summary) }.getOrNull() }
                                            Toast.makeText(context, if (exportedUri != null) R.string.archive_exported else R.string.archive_export_failed, Toast.LENGTH_SHORT).show()
                                        } finally { exporting = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = AppSpace.small),
                                colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                            TextButton(
                                text = stringResource(R.string.archive_export_image),
                                enabled = !exporting,
                                onClick = {
                                    scope.launch {
                                        exporting = true
                                        try {
                                            exportedUri = withContext(Dispatchers.IO) { runCatching { ProfileImageGenerator.saveArchivePng(context, item, summary) }.getOrNull() }
                                            Toast.makeText(context, if (exportedUri != null) R.string.archive_exported else R.string.archive_export_failed, Toast.LENGTH_SHORT).show()
                                        } finally { exporting = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = AppSpace.small),
                                colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.primary),
                            )
                        }
                    }
                }
            }
        }
    }
    ProfileFormsSheet(container, showForms) { showForms = false }
    val exportPreview by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, exportedUri) {
        previewLoading = true
        value = null
        val uri = exportedUri
        value = withContext(Dispatchers.IO) {
            runCatching { uri?.let { context.contentResolver.openInputStream(it)?.use { stream ->
                android.graphics.BitmapFactory.decodeStream(stream)?.asImageBitmap()
            } } }.getOrNull()
        }
        previewLoading = false
    }
    OverlaySheet(show = exportedUri != null, title = "图片预览", onDismiss = { exportedUri = null }) {
        val bitmap = exportPreview
        if (bitmap == null) PageState(stringResource(if (previewLoading) R.string.loading else R.string.image_unavailable), loading = previewLoading)
        else Column(Modifier.verticalScroll(rememberScrollState()).padding(AppSpace.page),
            verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            Image(bitmap, contentDescription = "已生成的档案图片",
                modifier = Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat() / bitmap.height)
                    .clip(RoundedCornerShape(AppShape.control)), contentScale = ContentScale.Fit)
            NoticeBanner(stringResource(R.string.archive_exported))
        }
    }
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
                        Column(Modifier.fillMaxWidth().padding(AppSpace.inset),
                            verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                                Icon(MiuixIcons.Promotions, contentDescription = null,
                                    modifier = Modifier.size(24.dp), tint = MiuixTheme.colorScheme.primary)
                                Text(item.title, modifier = Modifier.weight(1f), style = MiuixTheme.textStyles.body1)
                                StatusChip(stringResource(if (item.read) R.string.portal_read else R.string.portal_unread),
                                    if (item.read) MiuixTheme.colorScheme.onSurfaceVariantSummary else MiuixTheme.colorScheme.primary)
                            }
                            HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
                            Text(item.content, style = MiuixTheme.textStyles.body2,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
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
    // 「罩杯」只对女性适用（与 Web 端一致）。用 derivedStateOf 只订阅「性别」这一个键，
    // 这样输入其它字段时不会把这张表牵进来重组。
    val gender by remember { derivedStateOf { values["性别"].orEmpty() } }
    val visibleFields = remember(selectedForm, gender) {
        selectedForm?.fields?.filterNot { it.name == "罩杯" && gender != "女" } ?: emptyList()
    }
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
    // 这个弹层字段最多：每个字段一张卡片或一个输入框，如实走 squircle 渲染滑动会掉帧，
    // 所以只在这里关掉（见 OverlaySheet 的 squircle 参数）。
    OverlaySheet(show = show, title = "档案填写", onDismiss = onDismiss, busy = busy, squircle = false) {
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
                    SettingGroup { OverlayDropdownPreference(
                        title = "档案分卷", items = forms.map { it.name }, selectedIndex = selectedIndex,
                        enabled = !busy, onSelectedIndexChange = { selectedIndex = it }, modifier = Modifier.fillMaxWidth(),
                    ) }
                }
                selectedForm.content?.takeIf { it.isNotBlank() }?.let { description ->
                    item { NoticeBanner(description) }
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
                item { NoticeBanner(stringResource(R.string.required_hint)) }
                items(visibleFields, key = { it.name }) { field ->
                    // 键入任何字段都会整体替换 values，直接读它会让整张表单的所有字段跟着重组。
                    // derivedStateOf 把订阅收窄到本字段：值没变就不会重建这一行。
                    val value by remember(field.name) { derivedStateOf { values[field.name].orEmpty() } }
                    // 必填项标签带 *（与 Web 端一致），说明见上方提示。
                    val label = if (field.required) "${field.name} *" else field.name
                    when (field.type) {
                        "SELECT" -> SettingGroup { OverlayDropdownPreference(
                            title = label, items = listOf("请选择") + field.options,
                            selectedIndex = (field.options.indexOf(value) + 1).coerceAtLeast(0), enabled = !busy && editable,
                            onSelectedIndexChange = { index ->
                                val next = if (index == 0) "" else field.options[index - 1]
                                // 性别改成非「女」时顺手清掉罩杯，避免留下不适用的数据。
                                values = if (field.name == "性别" && next != "女") {
                                    values + (field.name to next) + ("罩杯" to "")
                                } else {
                                    values + (field.name to next)
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) }
                        "DATE" -> DatePreference(label, value, enabled = !busy && editable,
                            monthOnly = field.name == "出生年月") { values = values + (field.name to it) }
                        else -> FramedTextField(value = value, onValueChange = { values = values + (field.name to it) }, label = label, enabled = !busy && editable, modifier = Modifier.fillMaxWidth())
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
                modifier = Modifier.fillMaxWidth().height(if (contentScale == ContentScale.Crop) 200.dp else 140.dp)
                    .clip(RoundedCornerShape(AppShape.thumbnail)).background(androidx.compose.ui.graphics.Color.White).padding(AppSpace.small),
                contentScale = ContentScale.Fit,
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
    BasicComponent(title = label, onClick = onClick,
        endActions = { Icon(MiuixIcons.Basic.ArrowRight, contentDescription = null) })
}
