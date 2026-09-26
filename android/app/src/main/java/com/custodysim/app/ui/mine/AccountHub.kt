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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
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
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Promotions
import top.yukonga.miuix.kmp.icon.extended.Notes
import top.yukonga.miuix.kmp.icon.extended.Photos
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

/** Unknown server-defined fields stay visible in their own section. */
private fun profileSection(name: String): String = when (name) {
    "姓名", "性别", "年龄", "出生年月", "出生日", "民族", "籍贯", "籍贯（到市即可）", "婚姻状况" -> "基本信息"
    "罪名", "刑期起始日期", "刑期截止日期" -> "入监信息"
    "健康状态", "健康状况", "技能", "职业", "文化程度" -> "健康与教育"
    "身高（cm）", "体重（kg）", "身高", "体重", "肤色", "血型", "脸型", "发际", "眉形", "眼睛", "鼻形", "嘴形", "唇形", "牙齿", "下巴", "耳形" -> "体貌特征"
    "胸围（cm）", "腰围（cm）", "臀围（cm）", "肩宽（cm）", "足长（cm）", "鞋码", "罩杯", "体态备注（纹身、疤痕或明显体征）" -> "体态与尺寸"
    else -> when {
        name.startsWith("刑期") -> "入监信息"
        listOf("胸围", "腰围", "臀围", "肩宽", "足长", "体态备注").any { name.startsWith(it) } -> "体态与尺寸"
        name.startsWith("身高") || name.startsWith("体重") -> "体貌特征"
        else -> "其他信息"
    }
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

    OverlaySheet(show = panel != null, title = stringResource(R.string.portal_archives), onDismiss = { panel = null },
        // 加载态与列表共用同一块固定高度区域（0.82 屏高）：数据到达时弹层不再突然长高。
        bodyFraction = 0.82f) {
        when {
            loading -> PageState(stringResource(R.string.loading), loading = true)
            error != null -> PageState(stringResource(R.string.load_failed), error)
            archives.isEmpty() -> PageState(stringResource(R.string.portal_empty_archives))
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(AppSpace.page),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
            ) {
                items(archives, key = { it.id }, contentType = { "archive" }) { item ->
                    SettingGroup {
                        // 用 Column 统一内边距与行间距，避免相邻的整宽按钮彼此紧贴。
                        Column(
                            Modifier.fillMaxWidth().padding(AppSpace.inset),
                            verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                                Box(Modifier.size(44.dp).background(MiuixTheme.colorScheme.primary.copy(alpha = .10f), CircleShape),
                                    contentAlignment = Alignment.Center) {
                                    Icon(MiuixIcons.Notes, null, Modifier.size(22.dp), tint = MiuixTheme.colorScheme.primary)
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(item.userName.ifBlank { "未填写" }, style = MiuixTheme.textStyles.body1)
                                    Text(item.formName, style = MiuixTheme.textStyles.footnote1,
                                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                }
                                StatusChip(statusLabel(item.status), if (item.status == "RETURNED")
                                    MiuixTheme.colorScheme.error else MiuixTheme.colorScheme.primary)
                            }
                            if (item.code != null || item.boxName != null) Text(
                                listOfNotNull(item.code?.let { "编号 $it" }, item.boxName?.let { "档案盒 $it" }).joinToString(" · "),
                                style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            item.lockedAt?.let { Text("归档于 $it", style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary) }

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
                            HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = .10f))
                            Text("导出图片", style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                            TextButton(
                                text = "身份牌",
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
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                            TextButton(
                                text = "档案图片",
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
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.primary),
                            )
                            }
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
    var loading by remember { mutableStateOf(show) }
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
    OverlaySheet(show = show, title = stringResource(R.string.portal_notices), onDismiss = onDismiss,
        // 与档案弹层一致：加载提示与公告列表共用固定高度（0.82 屏高），数据到达时弹层不突然长高。
        bodyFraction = 0.82f) {
        when {
            loading -> PageState(stringResource(R.string.loading), loading = true)
            error != null -> PageState(stringResource(R.string.load_failed), error)
            notices.isEmpty() -> PageState(stringResource(R.string.portal_empty_notices))
            else -> LazyColumn(
                // 高度由弹层内容区（bodyFraction）统一给出，列表在弹层内滚动。
                modifier = Modifier.fillMaxSize(),
                state = rememberAppListState(),
                contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
            ) {
                items(notices, key = { it.id }, contentType = { "notice" }) { item ->
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
    var forms by remember { mutableStateOf<List<ProfileForm>>(emptyList()) }
    var records by remember { mutableStateOf<List<ProfileRecord>>(emptyList()) }
    var selectedIndex by remember { mutableIntStateOf(0) }
    var values by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var photo by remember { mutableStateOf<String?>(null) }
    var signatureMode by remember { mutableStateOf("GENERATED") }
    var handwrittenSignature by remember { mutableStateOf<String?>(null) }
    var showSignatureEditor by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val selectedForm = forms.getOrNull(selectedIndex)
    val selectedRecord = selectedForm?.let { form -> records.firstOrNull { it.formId == form.id } }
    val editable = selectedRecord == null || selectedRecord.status == "DRAFT" || selectedRecord.status == "RETURNED"
    val draft = rememberFormDraft(container, "profile:${selectedForm?.id}:${selectedRecord?.updatedAt.orEmpty()}")
    val snackbar = LocalAppSnackbar.current
    fun persistDraft() {
        draft.replace(values.mapKeys { "field:${it.key}" } + mapOf("photo" to photo,
            "signatureMode" to signatureMode, "handwrittenSignature" to handwrittenSignature))
    }
    fun updateValues(next: Map<String, String>) { values = next; persistDraft() }
    suspend fun saveProfileDraft() {
        val form = selectedForm ?: return
        busy = true; error = null
        try {
            val data = org.json.JSONObject().apply { values.forEach { (key, value) -> put(key, value) } }
            when (val result = container.portalRepository.saveProfileRecord(form.id, data, photo,
                signatureMode, handwrittenSignature)) {
                is ApiResult.Ok -> {
                    draft.clear()
                    snackbar("草稿已保存到服务器")
                    when (val refreshed = container.portalRepository.profileRecords()) {
                        is ApiResult.Ok -> records = refreshed.data
                        is ApiResult.Err -> error = "已保存，但预览刷新失败：${refreshed.message}"
                    }
                }
                is ApiResult.Err -> error = result.message
            }
        } finally { busy = false }
    }
    val photoPicker = rememberImagePicker(1) { urls -> photo = urls.firstOrNull(); persistDraft() }
    // 「罩杯」只对女性适用（与 Web 端一致）。用 derivedStateOf 只订阅「性别」这一个键，
    // 这样输入其它字段时不会把这张表牵进来重组。
    val gender by remember { derivedStateOf { values["性别"].orEmpty() } }
    val visibleFields = remember(selectedForm, gender) {
        selectedForm?.fields?.filterNot { it.name == "罩杯" && gender != "女" } ?: emptyList()
    }
    val fieldSections = remember(visibleFields) { visibleFields.groupBy { profileSection(it.name) } }
    LaunchedEffect(show) {
        if (!show) return@LaunchedEffect
        loading = true; error = null
        val formResult = container.portalRepository.profileForms()
        val recordResult = container.portalRepository.profileRecords()
        if (formResult is ApiResult.Ok) forms = formResult.data else if (formResult is ApiResult.Err) error = formResult.message
        if (recordResult is ApiResult.Ok) records = recordResult.data else if (recordResult is ApiResult.Err) error = recordResult.message
        loading = false
    }
    LaunchedEffect(show, selectedForm?.id, selectedRecord?.updatedAt, draft.ready, loading) {
        if (!show || !draft.ready || loading) return@LaunchedEffect
        selectedForm?.let { form ->
            values = form.fields.associate { field -> field.name to (
                (if (editable) draft.values["field:${field.name}"] as? String else null)
                    ?: selectedRecord?.data?.optString(field.name)?.takeIf { it != "null" } ?: "") }
            photo = if (editable && draft.values.containsKey("photo")) draft.values["photo"] as? String else selectedRecord?.photoData
            signatureMode = (if (editable) draft.values["signatureMode"] as? String else null)
                ?: selectedRecord?.signatureMode ?: "GENERATED"
            handwrittenSignature = if (editable && draft.values.containsKey("handwrittenSignature")) {
                draft.values["handwrittenSignature"] as? String
            } else selectedRecord?.signatureData?.takeIf { selectedRecord.signatureMode == "HANDWRITTEN" }
        }
    }
    if (show && showSignatureEditor && editable) SignatureEditor(
        onDismiss = { showSignatureEditor = false },
        onConfirm = {
            handwrittenSignature = it
            signatureMode = "HANDWRITTEN"
            persistDraft()
            showSignatureEditor = false
        },
    )
    LaunchedEffect(show, selectedForm?.id) { showSignatureEditor = false }
    // 这个弹层字段最多：每个字段一张卡片或一个输入框，如实走 squircle 渲染滑动会掉帧，
    // 所以只在这里关掉（见 OverlaySheet 的 squircle 参数）。
    OverlaySheet(show = show, title = "档案填写", onDismiss = onDismiss, busy = busy, squircle = false,
        // 与「档案查看」一致：加载提示、草稿加载与表单共用固定高度（0.82 屏高）。
        bodyFraction = 0.82f) {
        when {
            loading -> PageState(stringResource(R.string.loading), loading = true)
            draft.error != null && !draft.ready -> PageState("草稿加载失败", draft.error)
            !draft.ready -> PageState(stringResource(R.string.loading), loading = true)
            error != null && forms.isEmpty() -> PageState(stringResource(R.string.load_failed), error)
            forms.isEmpty() -> PageState("暂无可填写档案")
            selectedForm == null -> PageState("暂无可填写档案")
            else -> LazyColumn(
                // 高度由弹层内容区（bodyFraction）统一给出：长表单仍能在弹层内滚动，
                // 且加载态、切换分卷前后都用同一块区域。
                state = rememberAppListState(),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.Top,
            ) {
                item {
                    SettingGroup(Modifier.padding(bottom = AppSpace.medium)) { OverlayDropdownPreference(
                        title = "档案分卷", items = forms.map { it.name }, selectedIndex = selectedIndex,
                        enabled = !busy, onSelectedIndexChange = { selectedIndex = it }, modifier = Modifier.fillMaxWidth(),
                    ) }
                }
                selectedForm.content?.takeIf { it.isNotBlank() }?.let { description ->
                    item {
                        var expanded by remember(selectedForm.id) { mutableStateOf(false) }
                        SettingGroup(Modifier.padding(bottom = AppSpace.medium)) {
                            BasicComponent(title = "填写说明", summary = if (expanded) "收起说明" else "查看填写要求与签署说明",
                                onClick = { expanded = !expanded },
                                endActions = { Icon(MiuixIcons.Basic.ArrowRight, null) })
                            if (expanded) Text(description, style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                                modifier = Modifier.padding(start = AppSpace.page, end = AppSpace.page, bottom = AppSpace.page))
                        }
                    }
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
                    SettingGroup(Modifier.padding(bottom = AppSpace.medium)) {
                    Row(Modifier.fillMaxWidth().padding(AppSpace.page), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpace.page)) {
                        val photoBitmap = rememberDataUrlImage(photo)
                        Box(Modifier.size(72.dp, 92.dp).clip(RoundedCornerShape(12.dp))
                            .background(MiuixTheme.colorScheme.surface), contentAlignment = Alignment.Center) {
                            if (photoBitmap != null) Image(photoBitmap, "证件照", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            else Icon(MiuixIcons.Photos, null, tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                        Text("证件照", style = MiuixTheme.textStyles.body1)
                        Text("用于身份牌与档案图片", style = MiuixTheme.textStyles.footnote1,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        if (editable) {
                            TextButton(
                                text = stringResource(if (photo != null) R.string.change_photo else R.string.add_photo),
                                enabled = !busy,
                                onClick = photoPicker,
                                colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.primary),
                            )
                            if (photo != null) TextButton(
                                text = "移除照片",
                                enabled = !busy,
                                onClick = { photo = null; persistDraft() },
                            )
                        }
                        }
                    }
                    }
                }
                item { NoticeBanner(stringResource(R.string.required_hint)) }
                item { draft.error?.let { NoticeBanner(it, error = true) } }
                fieldSections.forEach { (section, fields) ->
                item(key = "heading:$section") { SectionTitle(section) }
                itemsIndexed(fields, key = { _, field -> "field:${field.name}" }, contentType = { _, field -> field.type }) { index, field ->
                    GroupedListItem(first = index == 0, last = index == fields.lastIndex) {
                    // 键入任何字段都会整体替换 values，直接读它会让整张表单的所有字段跟着重组。
                    // derivedStateOf 把订阅收窄到本字段：值没变就不会重建这一行。
                    val value by remember(field.name) { derivedStateOf { values[field.name].orEmpty() } }
                    // 必填项标签带 *（与 Web 端一致），说明见上方提示。
                    val label = if (field.required) "${field.name} *" else field.name
                    when (field.type) {
                        "SELECT" -> OverlayDropdownPreference(
                            title = label, items = listOf("请选择") + field.options,
                            selectedIndex = (field.options.indexOf(value) + 1).coerceAtLeast(0), enabled = !busy && editable,
                            onSelectedIndexChange = { index ->
                                val next = if (index == 0) "" else field.options[index - 1]
                                // 性别改成非「女」时顺手清掉罩杯，避免留下不适用的数据。
                                updateValues(if (field.name == "性别" && next != "女") {
                                    values + (field.name to next) + ("罩杯" to "")
                                } else {
                                    values + (field.name to next)
                                })
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        "DATE" -> DatePreference(label, value, enabled = !busy && editable,
                            monthOnly = field.name == "出生年月", standalone = false) { updateValues(values + (field.name to it)) }
                        else -> FramedTextField(value = value, onValueChange = { updateValues(values + (field.name to it)) }, label = label,
                            enabled = !busy && editable, modifier = Modifier.fillMaxWidth().padding(horizontal = AppSpace.page, vertical = AppSpace.small))
                    }
                    if (index != fields.lastIndex) HorizontalDivider(Modifier.padding(horizontal = AppSpace.page),
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = .08f))
                    }
                }
                item(key = "space:$section") { Spacer(Modifier.height(AppSpace.medium)) }
                }
                // Signature mode follows the Web/API contract; seals remain server-managed.
                item {
                    SectionTitle("签署确认")
                }
                item {
                    SettingGroup {
                        Column(Modifier.fillMaxWidth().padding(AppSpace.page),
                            verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                            OverlayDropdownPreference(title = "电子签名", items = listOf("规范签名", "手写签名"),
                                selectedIndex = if (signatureMode == "HANDWRITTEN") 1 else 0,
                                enabled = editable && !busy,
                                onSelectedIndexChange = { index ->
                                    if (index == 0) {
                                        signatureMode = "GENERATED"; handwrittenSignature = null; persistDraft()
                                    } else showSignatureEditor = true
                                })
                            ArchiveImage("签名预览",
                                if (signatureMode == "HANDWRITTEN") handwrittenSignature
                                else selectedRecord?.signatureData?.takeIf { selectedRecord.signatureMode == "GENERATED" },
                                ContentScale.Fit, emptyText = if (signatureMode == "HANDWRITTEN") "请签写后保存"
                                    else "保存草稿时，服务器将按当前账户姓名生成规范签名。")
                            if (signatureMode == "HANDWRITTEN" && editable) TextButton("重新签写",
                                enabled = !busy, onClick = { showSignatureEditor = true },
                                modifier = Modifier.fillMaxWidth())
                            if (signatureMode == "GENERATED" && editable) TextButton("生成规范签名并保存草稿",
                                enabled = !busy, onClick = { scope.launch { saveProfileDraft() } },
                                colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.primary), modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
                item {
                    SettingGroup(Modifier.padding(top = AppSpace.medium, bottom = AppSpace.medium)) {
                    Column(Modifier.padding(AppSpace.page)) { ArchiveImage(
                        "公章",
                        selectedRecord?.officialSealData,
                        ContentScale.Fit,
                        emptyText = "管理处最终审批后加盖公章",
                    ) }
                    }
                }
                item {
                    // 一个 lazy item 里平铺多个根节点会互相重叠，按钮统一放进 Column 排列。
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                        TextButton("保存草稿", enabled = !busy && editable, modifier = Modifier.weight(1f),
                            colors = if (selectedRecord == null) ButtonDefaults.textButtonColorsPrimary()
                                else ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.primary), onClick = {
                            scope.launch { saveProfileDraft() }
                        })
                        selectedRecord?.let { record ->
                            if (record.status == "DRAFT" || record.status == "RETURNED") TextButton(
                                text = "提交会签", enabled = !busy, onClick = {
                                    scope.launch {
                                        busy = true
                                        val data = org.json.JSONObject().apply { values.forEach { (key, value) -> put(key, value) } }
                                        val saved = container.portalRepository.saveProfileRecord(selectedForm.id, data, photo,
                                            signatureMode, handwrittenSignature)
                                        val result = if (saved is ApiResult.Err) saved else container.portalRepository.submitProfileRecord(record.id)
                                        when (result) {
                                            is ApiResult.Ok -> { draft.clear(); snackbar("档案已提交会签"); onDismiss() }
                                            is ApiResult.Err -> error = result.message
                                        }
                                        busy = false
                                    }
                                }, modifier = Modifier.weight(1f), colors = ButtonDefaults.textButtonColorsPrimary(),
                            )
                        }
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
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
        Text(label, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        when {
            bitmap != null -> Image(
                bitmap = bitmap,
                contentDescription = label,
                modifier = Modifier.fillMaxWidth().height(when {
                    contentScale == ContentScale.Crop -> 160.dp
                    label == "公章" -> 104.dp
                    else -> 88.dp
                })
                    .clip(RoundedCornerShape(12.dp)).background(androidx.compose.ui.graphics.Color.White)
                    .border(1.dp, MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = .12f), RoundedCornerShape(12.dp))
                    .padding(AppSpace.medium),
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
