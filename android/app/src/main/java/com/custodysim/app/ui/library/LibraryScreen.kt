package com.custodysim.app.ui.library

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.custodysim.app.AppContainer
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Back
import top.yukonga.miuix.kmp.theme.MiuixTheme
import java.io.File

private data class LibraryBook(val id: String, val title: String, val author: String, val format: String,
    val page: Int, val seconds: Int, val updatedAt: String, val coverUrl: String?, val enabled: Boolean)
private data class ReadingTask(val title: String, val minutes: Int, val seconds: Int, val approved: Boolean)
private data class LibraryCatalog(val books: List<LibraryBook>, val todaySeconds: Int, val points: Int,
    val minutesPerPoint: Int, val cap: Int, val scoring: Boolean, val tasks: List<ReadingTask>)

private fun catalog(json: JSONObject): LibraryCatalog {
    val books = json.optJSONArray("books")
    val tasks = json.optJSONArray("readingTasks")
    val policy = json.optJSONObject("scorePolicy") ?: JSONObject()
    return LibraryCatalog((0 until (books?.length() ?: 0)).mapNotNull { index ->
        val item = books?.optJSONObject(index) ?: return@mapNotNull null
        LibraryBook(item.optString("id"), item.optString("title"), item.optString("author"),
            item.optString("format").uppercase(), item.optInt("page", 1).coerceAtLeast(1),
            item.optInt("seconds"), item.optString("updatedAt").takeUnless { it == "null" }.orEmpty(),
            item.optString("coverUrl").takeIf { it.isNotBlank() && it != "null" }, item.optBoolean("enabled", true))
    }, json.optInt("todaySeconds"), json.optInt("todayPoints"), policy.optInt("minutesPerPoint", 15),
        policy.optInt("dailyCap", 3), policy.optBoolean("enabled", true),
        (0 until (tasks?.length() ?: 0)).mapNotNull { index ->
            val item = tasks?.optJSONObject(index) ?: return@mapNotNull null
            ReadingTask(item.optString("title"), item.optInt("readingMinutes"), item.optInt("readingSeconds"),
                item.optString("status") == "APPROVED")
        })
}

@Composable
fun LibraryScreen(container: AppContainer, admin: Boolean = false, onClose: () -> Unit) {
    var managing by remember { mutableStateOf(false) }
    var isAdmin by remember(admin) { mutableStateOf(admin) }
    var selected by remember { mutableStateOf<LibraryBook?>(null) }
    var data by remember { mutableStateOf<LibraryCatalog?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var format by rememberSaveable { mutableStateOf("全部") }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val notify: (String) -> Unit = { message -> scope.launch { snackbar.showSnackbar(message) } }
    LaunchedEffect(container, revision) {
        loading = true
        when (val result = container.apiClient.get("/api/library")) {
            is ApiResult.Ok -> { data = catalog(result.data); isAdmin = admin || result.data.optString("actorRole") == "ADMIN"; error = null }
            is ApiResult.Err -> error = result.message
        }
        loading = false
    }
    BackHandler { if (selected != null) { selected = null; revision++ } else onClose() }
    CompositionLocalProvider(LocalAppSnackbar provides notify) {
        if (managing && isAdmin) LibraryAdminScreen(container, onClose = { managing = false; revision++ })
        else if (selected != null) {
            BookReader(container, selected!!, onBack = { selected = null; revision++ },
                onAcknowledged = { revision++ }, notify = notify, snackbar = snackbar)
        } else Scaffold(
            topBar = { SmallTopAppBar(title = "图书馆", navigationIcon = {
                IconButton(onClick = onClose) { Icon(MiuixIcons.Back, "关闭图书馆") }
            }, actions = {
                if (isAdmin) TextButton("管理", onClick = { managing = true })
                TextButton("刷新", enabled = !loading, onClick = { revision++ })
            }) },
            snackbarHost = { SnackbarHost(snackbar, Modifier.imePadding()) },
        ) { padding ->
            val value = data
            val visible = value?.books.orEmpty().filter { book ->
                (isAdmin || book.enabled) && (format == "全部" || book.format == format) &&
                    (book.title.contains(query.trim(), true) || book.author.contains(query.trim(), true))
            }
            BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val columns = if (maxWidth >= 600.dp) 3 else 2
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 22.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(AppSpace.page)) {
                if (value != null) item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("今日阅读 ${value.todaySeconds / 60} 分钟", style = MiuixTheme.textStyles.footnote1,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        Text("积分 ${value.points} / ${value.cap}", style = MiuixTheme.textStyles.footnote1,
                            color = MiuixTheme.colorScheme.primary)
                    }
                }
                val recent = value?.books?.filter { it.enabled && it.updatedAt.isNotEmpty() }?.maxByOrNull { it.updatedAt }
                if (recent != null && query.isBlank() && format == "全部") item {
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
                        .background(MiuixTheme.colorScheme.primary.copy(alpha = .07f)).clickable { selected = recent }
                        .padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        BookCover(container, recent, Modifier.width(80.dp).height(112.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("继续阅读", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary)
                            Text(recent.title, style = MiuixTheme.textStyles.body1.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text("读到第 ${recent.page} 页", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        }
                    }
                }
                if (value?.tasks?.isNotEmpty() == true) item {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            value.tasks.take(2).forEach { task ->
                                Text("${task.title} · ${if (task.approved) "已自动通过" else "${(task.seconds / 60).coerceAtMost(task.minutes)} / ${task.minutes} 分钟"}",
                                    style = MiuixTheme.textStyles.footnote1,
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            }
                        }
                }
                item {
                    TextField(value = query, onValueChange = { query = it }, label = "搜索书名或作者",
                        singleLine = true, modifier = Modifier.fillMaxWidth(), colors = softTextFieldColors())
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = AppSpace.small)) {
                        listOf("全部", "EPUB", "PDF", "DOCX", "TXT").forEach { option ->
                            TextButton(option, onClick = { format = option },
                                colors = if (format == option) ButtonDefaults.textButtonColorsPrimary() else ButtonDefaults.textButtonColors())
                        }
                    }
                }
                if (error != null) item { PageState("暂时无法加载图书馆", error, onRetry = { revision++ }) }
                if (loading && value == null) item { PageState("正在打开图书馆", loading = true) }
                if (!loading && error == null && visible.isEmpty()) item {
                    PageState(if (value?.books?.isEmpty() != false) "图书馆还没有书籍" else "没有找到相关书籍",
                        if (value?.books?.isEmpty() != false) "管理员上传后，电子书会出现在这里。" else "试试其他书名、作者或格式。")
                }
                items(visible.chunked(columns), key = { it.first().id }) { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        row.forEach { book ->
                            Column(Modifier.weight(1f).clickable(enabled = book.enabled) { selected = book }, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                BookCover(container, book, Modifier.fillMaxWidth().aspectRatio(.7f))
                                Text(book.title, style = MiuixTheme.textStyles.body1.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium),
                                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(book.author.ifBlank { book.format }, style = MiuixTheme.textStyles.footnote1.copy(fontSize = 12.sp),
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                if (!book.enabled) Text("未上架", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            }
                        }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
                item { Text("阅读进度自动保存，切到后台后暂停计时。", style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary, modifier = Modifier.padding(AppSpace.small)) }
            }
            }
        }
    }
}

@Composable
private fun BookCover(container: AppContainer, book: LibraryBook, modifier: Modifier) {
    val state = rememberRemoteImageState(container.apiClient.remoteImages,
        book.coverUrl?.let { container.apiClient.imageUrl(it) }, 512)
    Box(modifier.clip(RoundedCornerShape(10.dp)).background(MiuixTheme.colorScheme.primary.copy(alpha = .07f)),
        contentAlignment = Alignment.Center) {
        state.bitmap?.let { Image(it, "${book.title}封面", Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            ?: Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(book.format, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary)
                Text(book.title, style = MiuixTheme.textStyles.body1.copy(fontSize = 14.sp), maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(if (state.loading && book.coverUrl != null) "加载封面…" else if (book.coverUrl != null) "封面暂不可用" else "暂无封面",
                    style = MiuixTheme.textStyles.footnote1.copy(fontSize = 11.sp), color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
        }
}

private class PdfDocument(val file: File) : AutoCloseable {
    private val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    val renderer = PdfRenderer(descriptor)
    fun render(index: Int): Bitmap = synchronized(this) {
        renderer.openPage(index).use { page ->
            val factor = minOf(1400f / page.width, 2400f / page.height)
            val width = (page.width * factor).toInt().coerceAtLeast(1)
            val height = (page.height * factor).toInt().coerceAtLeast(1)
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
                it.eraseColor(android.graphics.Color.WHITE)
                page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            }
        }
    }
    override fun close() = synchronized(this) { renderer.close(); descriptor.close(); file.delete(); Unit }
}

@OptIn(ExperimentalCoroutinesApi::class)
@Composable
private fun BookReader(container: AppContainer, book: LibraryBook, onBack: () -> Unit,
    onAcknowledged: () -> Unit, notify: (String) -> Unit, snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val preferences = remember { context.getSharedPreferences("library-reader", 0) }
    var tone by remember { mutableStateOf(preferences.getString("tone", "paper") ?: "paper") }
    var font by remember { mutableIntStateOf(preferences.getInt("font", 19).coerceIn(16, 28)) }
    var lineHeight by remember { mutableFloatStateOf(preferences.getFloat("lineHeight", 1.85f).coerceIn(1.5f, 2.3f)) }
    var settings by remember { mutableStateOf(false) }
    var page by rememberSaveable(book.id) { mutableIntStateOf(book.page) }
    var jump by remember { mutableStateOf("") }
    var jumping by remember { mutableStateOf(false) }
    var paused by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf<List<String>?>(null) }
    var pdf by remember { mutableStateOf<PdfDocument?>(null) }
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var sessionError by remember { mutableStateOf<String?>(null) }
    var connected by remember { mutableStateOf(false) }
    var credited by remember { mutableIntStateOf(0) }
    var retry by remember { mutableIntStateOf(0) }
    var sessionRetry by remember { mutableIntStateOf(0) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val changes = remember(book.id) { Channel<Unit>(Channel.CONFLATED) }
    val latestPage by rememberUpdatedState(page)
    val latestPaused by rememberUpdatedState(paused || settings || jumping || loading || error != null || (book.format == "PDF" && bitmap == null))
    val latestAcknowledged by rememberUpdatedState(onAcknowledged)
    val latestNotify by rememberUpdatedState(notify)
    val ready = !loading && error == null && (text != null || pdf != null)
    val count = pdf?.renderer?.pageCount ?: text?.size ?: 1
    val background = when (tone) { "night" -> Color(0xFF1C1D21); "day" -> Color.White; else -> Color(0xFFF8F2E6) }
    val ink = if (tone == "night") Color(0xFFE2DED5) else Color(0xFF32312D)
    val muted = if (tone == "night") Color(0xFFA9A59C) else Color(0xFF77736B)
    BackHandler { if (settings) settings = false else if (jumping) jumping = false else onBack() }
    LaunchedEffect(tone, font, lineHeight) { preferences.edit { putString("tone", tone); putInt("font", font); putFloat("lineHeight", lineHeight) } }
    LaunchedEffect(book.id, retry) {
        loading = true; error = null
        var document: PdfDocument? = null
        try {
            val path = if (book.format == "PDF") "/api/library/${book.id}/file" else "/api/library/${book.id}/content"
            when (val result = container.apiClient.getBytes(path)) {
                is ApiResult.Err -> error = result.message
                is ApiResult.Ok -> if (book.format == "PDF") {
                    document = withContext(Dispatchers.IO) {
                        val file = File.createTempFile("library-", ".pdf", context.cacheDir)
                        try { file.writeBytes(result.data); PdfDocument(file) }
                        catch (problem: Exception) { file.delete(); throw problem }
                    }
                    pdf = document
                    page = page.coerceIn(1, document.renderer.pageCount.coerceAtLeast(1))
                } else {
                    text = withContext(Dispatchers.Default) {
                        val characters = result.data.toString(Charsets.UTF_8).codePoints().toArray()
                        if (characters.isEmpty()) listOf("本书暂无可阅读正文。") else
                            (characters.indices step 2000).map { start -> String(characters, start, minOf(2000, characters.size - start)) }
                    }
                    page = page.coerceIn(1, text!!.size)
                }
            }
            loading = false
            awaitCancellation()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "无法打开电子书"; loading = false }
        finally { pdf = null; withContext(NonCancellable + Dispatchers.IO) { document?.close() } }
    }
    LaunchedEffect(pdf, page) {
        bitmap = null; zoom = 1f; pan = Offset.Zero
        val document = pdf ?: return@LaunchedEffect
        try { bitmap = withContext(Dispatchers.IO) { document.render(page - 1) } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "这一页暂时无法显示" }
    }
    LaunchedEffect(ready, owner, sessionRetry) {
        if (!ready) return@LaunchedEffect
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var session: String? = null
            try {
                when (val result = container.apiClient.post("/api/library/reading", JSONObject().put("bookId", book.id))) {
                    is ApiResult.Err -> { sessionError = result.message; return@repeatOnLifecycle }
                    is ApiResult.Ok -> session = result.data.optString("sessionId")
                }
                connected = true; sessionError = null
                while (isActive) {
                    when (val ack = container.apiClient.patch("/api/library/reading", JSONObject()
                        .put("sessionId", session).put("active", !latestPaused).put("page", latestPage))) {
                        is ApiResult.Err -> { sessionError = ack.message; connected = false; return@repeatOnLifecycle }
                        is ApiResult.Ok -> {
                            credited += ack.data.optInt("creditedSeconds")
                            if (ack.data.optInt("awardedPoints") > 0 || ack.data.optInt("approvedTasks") > 0) {
                                latestAcknowledged()
                                if (ack.data.optInt("approvedTasks") > 0) latestNotify("阅读时长已达标，学习任务已自动通过")
                            }
                        }
                    }
                    select<Unit> { changes.onReceive { }; onTimeout(15_000) { } }
                }
            } finally {
                connected = false
                withContext(NonCancellable) {
                    if (!session.isNullOrBlank()) {
                        val ack = container.apiClient.patch("/api/library/reading", JSONObject()
                            .put("sessionId", session).put("active", false).put("close", true).put("page", latestPage))
                        if (ack is ApiResult.Ok) {
                            credited += ack.data.optInt("creditedSeconds")
                            latestAcknowledged()
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(page, paused, settings, jumping, bitmap == null) { changes.trySend(Unit) }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar, Modifier.imePadding()) },
        topBar = {
            Row(Modifier.fillMaxWidth().background(background).statusBarsPadding().heightIn(min = 56.dp)
                .padding(horizontal = AppSpace.small), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(MiuixIcons.Back, "返回图书馆", tint = ink) }
                Text(book.title, color = ink, style = MiuixTheme.textStyles.body1,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = AppSpace.small))
                TextButton(if (settings) "完成" else "Aa", onClick = { settings = !settings },
                    colors = ButtonDefaults.textButtonColors(color = Color.Transparent, textColor = ink),
                    modifier = Modifier.semantics { contentDescription = "阅读外观设置" })
            }
        },
        bottomBar = {
            Column(Modifier.background(background).navigationBarsPadding().padding(horizontal = AppSpace.small)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    IconButton(enabled = ready && page > 1, onClick = { page--; jumping = false }) {
                        Icon(MiuixIcons.Back, "上一页", tint = if (ready && page > 1) ink else muted.copy(alpha = .4f))
                    }
                    TextButton("$page / $count", enabled = ready, onClick = { jump = page.toString(); jumping = !jumping },
                        modifier = Modifier.semantics { contentDescription = "当前第 $page 页，共 $count 页，跳转页码" })
                    IconButton(enabled = ready && page < count, onClick = { page++; jumping = false }) {
                        Icon(MiuixIcons.Back, "下一页", tint = if (ready && page < count) ink else muted.copy(alpha = .4f),
                            modifier = Modifier.graphicsLayer { rotationZ = 180f })
                    }
                }
                Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (sessionError != null) "阅读记录连接中断" else if (!ready) "正在打开" else if (latestPaused) "计时已暂停"
                        else if (!connected) "正在连接阅读记录" else "计时中 · 本次已记录 ${credited / 60} 分钟",
                        style = MiuixTheme.textStyles.footnote1, color = muted, modifier = Modifier.weight(1f).padding(start = AppSpace.small))
                    if (sessionError != null) TextButton("重连", onClick = { sessionRetry++ })
                    else TextButton(if (paused) "继续" else "暂停", enabled = ready, onClick = { paused = !paused })
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().background(background).padding(padding)) {
            if (settings) ReaderSettings(tone, { tone = it }, font, { font = it }, lineHeight, { lineHeight = it }, book.format == "PDF")
            if (jumping) Row(Modifier.padding(AppSpace.page), verticalAlignment = Alignment.CenterVertically) {
                TextField(jump, { jump = it.filter(Char::isDigit).take(6) }, label = "跳转页码（1–$count）", singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                TextButton("前往", enabled = jump.toIntOrNull() in 1..count, onClick = { page = jump.toInt(); jumping = false })
            }
            if (sessionError != null) Text(sessionError!!, style = MiuixTheme.textStyles.footnote1, color = muted,
                modifier = Modifier.padding(horizontal = AppSpace.inset))
            if (loading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else if (error != null) Box(Modifier.fillMaxSize().padding(AppSpace.page), contentAlignment = Alignment.Center) {
                PageState("暂时无法打开书籍", error, onRetry = { retry++ })
            } else if (book.format == "PDF") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    TextButton("缩小", enabled = zoom > 1f, onClick = { zoom = (zoom - .25f).coerceAtLeast(1f); pan = Offset.Zero })
                    TextButton("${(zoom * 100).toInt()}% · 复位", onClick = { zoom = 1f; pan = Offset.Zero })
                    TextButton("放大", enabled = zoom < 3f, onClick = { zoom = (zoom + .25f).coerceAtMost(3f); pan = Offset.Zero })
                }
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().pointerInput(Unit) {
                    detectTransformGestures { _, translation, scale, _ ->
                        zoom = (zoom * scale).coerceIn(1f, 3f)
                        val xBound = size.width * (zoom - 1f) / 2
                        val yBound = size.height * (zoom - 1f) / 2
                        pan = Offset((pan.x + translation.x).coerceIn(-xBound, xBound),
                            (pan.y + translation.y).coerceIn(-yBound, yBound))
                    }
                }, contentAlignment = Alignment.Center) {
                    bitmap?.let { image -> Image(image.asImageBitmap(), "${book.title}，第 $page 页",
                        modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y }) }
                        ?: CircularProgressIndicator()
                }
            } else {
                val scroll = rememberScrollState()
                LaunchedEffect(page) { scroll.scrollTo(0) }
                SelectionContainer(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll)) {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 26.dp, vertical = 28.dp)) {
                        Text("${book.title} · $page", style = MiuixTheme.textStyles.footnote1, color = muted,
                            modifier = Modifier.padding(bottom = 24.dp))
                        Text(text?.getOrNull(page - 1).orEmpty(), color = ink,
                            style = MiuixTheme.textStyles.body1.copy(fontSize = font.sp, lineHeight = (font * lineHeight).sp))
                        Text("· $page ·", style = MiuixTheme.textStyles.footnote1, color = muted,
                            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 32.dp, bottom = 16.dp))
                    }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReaderSettings(tone: String, onTone: (String) -> Unit, font: Int, onFont: (Int) -> Unit,
    lineHeight: Float, onLineHeight: (Float) -> Unit, pdf: Boolean) {
    Column(Modifier.fillMaxWidth().background(MiuixTheme.colorScheme.surface).padding(AppSpace.page)) {
        Text("阅读外观", style = MiuixTheme.textStyles.body1)
        Row { listOf("paper" to "暖纸", "day" to "浅色", "night" to "深色").forEach { (key, title) ->
            TextButton(title, onClick = { onTone(key) }, colors = if (tone == key) ButtonDefaults.textButtonColorsPrimary() else ButtonDefaults.textButtonColors())
        } }
        if (!pdf) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("字号 $font", modifier = Modifier.weight(1f))
                TextButton("A−", enabled = font > 16, onClick = { onFont(font - 1) }, modifier = Modifier.semantics { contentDescription = "缩小字号" })
                TextButton("A＋", enabled = font < 28, onClick = { onFont(font + 1) }, modifier = Modifier.semantics { contentDescription = "增大字号" })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("行距", modifier = Modifier.weight(1f))
                listOf(1.6f to "紧凑", 1.85f to "舒适", 2.15f to "宽松").forEach { (value, title) ->
                    TextButton(title, onClick = { onLineHeight(value) }, colors = if (lineHeight == value) ButtonDefaults.textButtonColorsPrimary() else ButtonDefaults.textButtonColors())
                }
            }
        } else Text("PDF 保留原始页面颜色，可在正文区双指缩放。", style = MiuixTheme.textStyles.footnote1)
        Text("设置会保留，下次阅读继续使用。", style = MiuixTheme.textStyles.footnote1,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
    }
}
