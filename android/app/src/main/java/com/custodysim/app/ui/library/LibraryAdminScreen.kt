package com.custodysim.app.ui.library

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Back
import top.yukonga.miuix.kmp.theme.MiuixTheme

private data class PickedFile(val uri: Uri, val name: String)
private fun JSONArray?.objects() = (0 until (this?.length() ?: 0)).mapNotNull { this?.optJSONObject(it) }

@Composable
internal fun LibraryAdminScreen(container: AppContainer, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var tab by remember { mutableStateOf("图书") }
    var revision by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var books by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var rules by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var users by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var groups by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var bookEditor by remember { mutableStateOf(false) }
    var bookId by remember { mutableStateOf<String?>(null) }
    var title by remember { mutableStateOf("") }
    var author by remember { mutableStateOf("") }
    var file by remember { mutableStateOf<PickedFile?>(null) }
    var cover by remember { mutableStateOf<PickedFile?>(null) }
    var removeCover by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf(false) }
    var taskEditor by remember { mutableStateOf(false) }
    var taskId by remember { mutableStateOf<String?>(null) }
    var taskName by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("30") }
    var time by remember { mutableStateOf("09:00") }
    var timeChanged by remember { mutableStateOf(false) }
    var timeout by remember { mutableStateOf("120") }
    var target by remember { mutableStateOf("全部") }
    var targetId by remember { mutableStateOf("") }
    var targetName by remember { mutableStateOf("") }
    var choosingTarget by remember { mutableStateOf(false) }
    var scoring by remember { mutableStateOf(true) }
    var perPoint by remember { mutableStateOf("15") }
    var cap by remember { mutableStateOf("3") }

    fun picked(uri: Uri): PickedFile {
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: "upload"
        return PickedFile(uri, name)
    }
    val pickBook = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) file = picked(uri)
    }
    val pickCover = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { cover = picked(uri); removeCover = false }
    }
    suspend fun uploadPart(picked: PickedFile, name: String, limit: Int): ApiClient.UploadPart = withContext(Dispatchers.IO) {
        val bytes = context.contentResolver.openInputStream(picked.uri)?.use { stream ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                require(output.size() + count <= limit) { if (name == "cover") "封面不能超过 3 MiB" else "电子书不能超过 20 MiB" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } ?: throw IllegalArgumentException("无法读取所选文件，请重新选择")
        ApiClient.UploadPart(name, picked.name, context.contentResolver.getType(picked.uri) ?: "application/octet-stream", bytes)
    }
    fun mutate(action: suspend () -> ApiResult<JSONObject>, done: () -> Unit = {}) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try {
                when (val result = action()) {
                    is ApiResult.Ok -> { container.apiClient.remoteImages.clear(); done(); revision++;
                        scope.launch { snackbar.showSnackbar("已保存") } }
                    is ApiResult.Err -> error = result.message
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { error = problem.message ?: "操作失败，请重试" }
            finally { busy = false }
        }
    }
    fun editBook(book: JSONObject? = null) {
        bookId = book?.optString("id"); title = book?.optString("title").orEmpty(); author = book?.optString("author").orEmpty()
        file = null; cover = null; removeCover = false; deleteConfirm = false; bookEditor = true; error = null
    }
    fun editTask(rule: JSONObject? = null) {
        taskId = rule?.optString("id"); taskName = rule?.optString("name").orEmpty()
        minutes = (rule?.optInt("readingMinutes") ?: 30).toString()
        timeout = (rule?.optInt("timeoutMinutes") ?: 120).toString()
        time = rule?.optJSONArray("timeSlots")?.optString(0)?.takeIf { Regex("\\d{2}:\\d{2}").matches(it) } ?: "09:00"
        timeChanged = false; target = "全部"; targetId = ""; targetName = ""; choosingTarget = false; taskEditor = true; error = null
    }
    LaunchedEffect(tab, revision) {
        loading = true
        val path = when (tab) { "图书" -> "/api/library"; "阅读任务" -> "/api/admin/library/tasks"; else -> "/api/admin/library/settings" }
        when (val result = container.apiClient.get(path)) {
            is ApiResult.Err -> error = result.message
            is ApiResult.Ok -> {
                if (tab == "图书") books = result.data.optJSONArray("books").objects()
                else if (tab == "阅读任务") {
                    rules = result.data.optJSONArray("rules").objects(); users = result.data.optJSONArray("users").objects(); groups = result.data.optJSONArray("groups").objects()
                } else {
                    scoring = result.data.optBoolean("enabled", true); perPoint = result.data.optInt("minutesPerPoint", 15).toString(); cap = result.data.optInt("dailyCap", 3).toString()
                }
            }
        }
        loading = false
    }
    fun back() { if (bookEditor) bookEditor = false else if (taskEditor) taskEditor = false else onClose() }
    BackHandler(enabled = !busy) { back() }
    Scaffold(topBar = { SmallTopAppBar(title = if (bookEditor) { if (bookId == null) "上传电子书" else "编辑图书" }
        else if (taskEditor) { if (taskId == null) "新增阅读任务" else "编辑阅读任务" } else "图书馆管理",
        navigationIcon = { IconButton(enabled = !busy, onClick = ::back) { Icon(MiuixIcons.Back, "返回") } },
        actions = { if (!bookEditor && !taskEditor) TextButton("刷新", enabled = !busy && !loading, onClick = { error = null; revision++ }) }) },
        snackbarHost = { SnackbarHost(snackbar, Modifier.imePadding()) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(), contentPadding = PaddingValues(AppSpace.page),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!bookEditor && !taskEditor) item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    listOf("图书", "阅读任务", "积分").forEach { option -> TextButton(option, enabled = !busy, onClick = { tab = option; error = null },
                        colors = if (tab == option) ButtonDefaults.textButtonColorsPrimary() else ButtonDefaults.textButtonColors()) }
                }
            }
            if (error != null) item { NoticeBanner(error!!, error = true) }
            if (bookEditor) {
                item { AdminField("书名", title, { title = it }, !busy) }
                item { AdminField("作者", author, { author = it }, !busy) }
                item {
                    TextButton(if (file == null) { if (bookId == null) "选择电子书" else "替换电子书（可选）" } else file!!.name,
                        enabled = !busy, onClick = { pickBook.launch(arrayOf("application/pdf", "application/epub+zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "application/octet-stream")) })
                    Text("PDF、EPUB、DOCX、TXT · 最大 20 MiB", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
                item {
                    TextButton(cover?.name ?: "选择封面（可选）", enabled = !busy, onClick = { pickCover.launch(arrayOf("image/png", "image/jpeg", "image/webp")) })
                    Text("PNG、JPEG、WebP · 最大 3 MiB", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    if (bookId != null) TextButton(if (removeCover) "保留原封面" else "移除原封面", enabled = !busy,
                        onClick = { removeCover = !removeCover; cover = null })
                }
                item { PrimaryAction("保存图书", busy = busy, enabled = title.isNotBlank() && (bookId != null || file != null), onClick = {
                    mutate(action = {
                        val parts = buildList { file?.let { add(uploadPart(it, "file", 20 * 1024 * 1024)) }; cover?.let { add(uploadPart(it, "cover", 3 * 1024 * 1024)) } }
                        container.apiClient.multipart(if (bookId == null) "/api/admin/library" else "/api/admin/library/$bookId",
                            buildMap { put("title", title.trim()); put("author", author.trim()); if (removeCover) put("removeCover", "true") }, parts, replace = bookId != null)
                    }, done = { bookEditor = false })
                }) }
                if (bookId != null) item {
                    if (deleteConfirm) {
                        Text("移出后所有书架将隐藏此书，历史阅读记录保留。", style = MiuixTheme.textStyles.footnote1)
                        Row {
                            TextButton("取消", enabled = !busy, onClick = { deleteConfirm = false })
                            TextButton("确认移出书架", enabled = !busy, onClick = { mutate({ container.apiClient.delete("/api/admin/library/$bookId") }, { bookEditor = false }) })
                        }
                    } else TextButton("移出书架", enabled = !busy, onClick = { deleteConfirm = true })
                }
            } else if (taskEditor) {
                item { AdminField("任务名称", taskName, { taskName = it }, !busy) }
                item { AdminField("所需阅读分钟数", minutes, { minutes = it.filter(Char::isDigit).take(4) }, !busy, number = true) }
                item { AdminField("每日派发时间（HH:mm）", time, { time = it.take(5); timeChanged = true }, !busy) }
                item { AdminField("完成时限（分钟）", timeout, { timeout = it.filter(Char::isDigit).take(4) }, !busy, number = true) }
                if (taskId == null) item {
                    Text("发给", style = MiuixTheme.textStyles.footnote1)
                    Row { listOf("全部", "个人", "任务组").forEach { option -> TextButton(option, enabled = !busy, onClick = {
                        target = option; targetId = ""; targetName = ""; choosingTarget = option != "全部"
                    }, colors = if (target == option) ButtonDefaults.textButtonColorsPrimary() else ButtonDefaults.textButtonColors()) } }
                    if (target != "全部") {
                        TextButton(targetName.ifEmpty { "选择$target" }, enabled = !busy, onClick = { choosingTarget = !choosingTarget })
                        if (choosingTarget) Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
                            val choices = if (target == "个人") users else groups
                            if (choices.isEmpty()) Text("没有可选择的$target", style = MiuixTheme.textStyles.footnote1)
                            choices.forEach { choice -> TextButton(choice.optString("name"), enabled = !busy, onClick = {
                                targetId = choice.optString("id"); targetName = choice.optString("name"); choosingTarget = false
                            }) }
                        }
                    }
                } else item { Text("保留原有频率和分配范围。只有修改派发时间时才替换原时段。", style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary) }
                item { Text("阅读时长满足要求后，任务自动通过。", style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary) }
                item { PrimaryAction("保存任务", busy = busy, enabled = taskName.isNotBlank() &&
                    (minutes.toIntOrNull() ?: 0) in 1..1440 && (timeout.toIntOrNull() ?: 0) >= (minutes.toIntOrNull() ?: Int.MAX_VALUE) &&
                    Regex("([01]\\d|2[0-3]):[0-5]\\d").matches(time) && (taskId != null || target == "全部" || targetId.isNotEmpty()), onClick = {
                    mutate(action = {
                        val payload = JSONObject().put("name", taskName.trim()).put("readingMinutes", minutes.toInt()).put("timeoutMinutes", timeout.toInt())
                        if (taskId == null || timeChanged) payload.put("timeSlot", time)
                        if (taskId == null) {
                            if (target == "个人") payload.put("userId", targetId)
                            if (target == "任务组") payload.put("groupId", targetId)
                            container.apiClient.post("/api/admin/library/tasks", payload)
                        } else container.apiClient.patch("/api/admin/library/tasks/$taskId", payload)
                    }, done = { taskEditor = false })
                }) }
            } else if (loading) item { PageState("正在读取管理数据", loading = true) }
            else when (tab) {
                "图书" -> {
                    item { PrimaryAction("上传电子书", enabled = !busy, onClick = { editBook() }) }
                    if (books.isEmpty()) item { PageState("还没有图书", "上传电子书并选择封面，双端书架会同步展示。") }
                    books.forEach { book -> item(key = book.optString("id")) {
                        SettingGroup { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                val coverUrl = book.optString("coverUrl").takeIf { it.isNotBlank() && it != "null" }
                                val image = rememberRemoteImageState(container.apiClient.remoteImages, coverUrl?.let { container.apiClient.imageUrl(it) }, 256)
                                Box(Modifier.width(50.dp).height(70.dp).clip(RoundedCornerShape(6.dp)).background(MiuixTheme.colorScheme.primary.copy(alpha = .07f)), contentAlignment = Alignment.Center) {
                                    image.bitmap?.let { Image(it, "${book.optString("title")}封面", Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                                        ?: Text(book.optString("format"), style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary)
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(book.optString("title"), style = MiuixTheme.textStyles.body1)
                                    Text("${book.optString("author")} · ${book.optString("format")} · ${if (book.optBoolean("enabled")) "已上架" else "未上架"}",
                                        style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                }
                            }
                            Row { TextButton("编辑", enabled = !busy, onClick = { editBook(book) })
                                TextButton(if (book.optBoolean("enabled")) "下架" else "上架", enabled = !busy, onClick = {
                                    mutate({ container.apiClient.patch("/api/admin/library/${book.optString("id")}", JSONObject().put("enabled", !book.optBoolean("enabled"))) })
                                }) }
                        } }
                    } }
                }
                "阅读任务" -> {
                    item { PrimaryAction("新增阅读任务", enabled = !busy, onClick = { editTask() }) }
                    if (rules.isEmpty()) item { PageState("还没有阅读任务", "设置阅读分钟数、派发时间和对象即可。") }
                    rules.forEach { rule -> item(key = rule.optString("id")) {
                        SettingGroup { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(rule.optString("name"), style = MiuixTheme.textStyles.body1)
                            Text("阅读 ${rule.optInt("readingMinutes")} 分钟 · ${if (rule.optBoolean("enabled")) "启用" else "停用"}",
                                style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            Text("派发 ${rule.optJSONArray("timeSlots").let { slots -> (0 until (slots?.length() ?: 0)).joinToString("、") { slots?.optString(it).orEmpty() } }} · 时限 ${rule.optInt("timeoutMinutes")} 分钟",
                                style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            val groupId = rule.optString("ruleGroupId").takeUnless { it.isBlank() || it == "null" }
                            val scopes = rule.optJSONArray("scopes").objects()
                            val audience = if (groupId != null) "任务组 ${groups.find { it.optString("id") == groupId }?.optString("name") ?: groupId}"
                                else if (scopes.isEmpty()) "未分配成员" else if (scopes.size > 3 && scopes.all { it.optString("targetType") == "USER" }) "${scopes.size} 位被监管人" else scopes.joinToString("、") { binding ->
                                    users.find { it.optString("id") == binding.optString("targetId") }?.optString("name") ?: "已配置对象"
                                }
                            Text("范围：$audience", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            Row { TextButton("编辑", enabled = !busy, onClick = { editTask(rule) })
                                TextButton(if (rule.optBoolean("enabled")) "停用" else "启用", enabled = !busy, onClick = {
                                    mutate({ container.apiClient.patch("/api/admin/library/tasks/${rule.optString("id")}", JSONObject().put("enabled", !rule.optBoolean("enabled"))) })
                                }) }
                        } }
                    } }
                }
                else -> {
                    item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("阅读积分", modifier = Modifier.weight(1f)); TextButton(if (scoring) "已启用" else "已停用", enabled = !busy, onClick = { scoring = !scoring })
                    } }
                    item { AdminField("每得 1 分所需分钟数", perPoint, { perPoint = it.filter(Char::isDigit).take(4) }, !busy, number = true) }
                    item { AdminField("每日积分上限（1–3）", cap, { cap = it.filter(Char::isDigit).take(1) }, !busy, number = true) }
                    item { PrimaryAction("保存积分设置", busy = busy, enabled = (perPoint.toIntOrNull() ?: 0) in 1..1440 && (cap.toIntOrNull() ?: 0) in 1..3,
                        onClick = { mutate({ container.apiClient.put("/api/admin/library/settings", JSONObject()
                            .put("enabled", scoring).put("minutesPerPoint", perPoint.toInt()).put("dailyCap", cap.toInt())) }) }) }
                }
            }
        }
    }
}

@Composable
private fun AdminField(label: String, value: String, change: (String) -> Unit, enabled: Boolean, number: Boolean = false) {
    TextField(value, change, label = label, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth(),
        colors = softTextFieldColors(), keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Number else KeyboardType.Text))
}
