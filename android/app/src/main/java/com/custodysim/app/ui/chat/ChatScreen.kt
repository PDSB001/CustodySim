package com.custodysim.app.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import android.util.Log
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.chat.*
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.basic.ArrowRight
import top.yukonga.miuix.kmp.icon.extended.Messages
import top.yukonga.miuix.kmp.icon.extended.Add
import top.yukonga.miuix.kmp.icon.extended.Send
import top.yukonga.miuix.kmp.icon.extended.Photos
import top.yukonga.miuix.kmp.icon.extended.Undo
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** 实时通道不可用时的兜底轮询间隔：比原来的 15 秒宽松，避免后台反复唤醒网络。 */
private const val CHAT_POLL_FALLBACK_MILLIS = 40_000L

private const val CHAT_TAG = "CustodySim.Chat"

/** 图片解码前的占位尺寸；解码后按原始比例收紧气泡，避免竖图两侧出现大片空白。 */
private val CHAT_IMAGE_SIZE = 176.dp

/**
 * 图片消息：走缩略图解码（带 LRU 缓存 + 降采样），不会把整张原图常驻内存。
 */
@Composable
private fun ChatImage(bitmap: ImageBitmap?, size: DpSize) {
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        if (bitmap != null) {
            Image(bitmap = bitmap, contentDescription = stringResource(R.string.chat_image),
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit)
        } else {
            Text(stringResource(R.string.image_unavailable), style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        }
    }
}

@Composable
private fun ChatBubble(
    item: ChatMessage,
    own: Boolean,
    supervised: Boolean,
    maxWidth: androidx.compose.ui.unit.Dp,
    onPreview: (String) -> Unit,
    onRecall: (ChatMessage) -> Unit,
) {
    if (item.recalled) {
        Box(Modifier.fillMaxWidth().padding(vertical = AppSpace.small), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.chat_recalled), style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        }
        return
    }
    val foreground = if (own && !item.isImage) MiuixTheme.colorScheme.onPrimary
        else MiuixTheme.colorScheme.onBackground
    val surface = when {
        own && item.isImage -> MiuixTheme.colorScheme.primary.copy(alpha = 0.10f)
        own -> MiuixTheme.colorScheme.primary
        else -> MiuixTheme.colorScheme.background
    }
    val recallable = own && item.canRecall(item.senderId.orEmpty())
    Row(Modifier.fillMaxWidth(),
        horizontalArrangement = if (own) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom) {
        if (!own) {
            Box(Modifier.padding(end = AppSpace.small, bottom = AppSpace.inset)
                .size(34.dp).clip(CircleShape)
                .background(MiuixTheme.colorScheme.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center) {
                com.custodysim.app.ui.common.UserAvatar(item.senderName ?: "?", item.senderAvatar, size = 34.dp)
            }
        }
        Column(Modifier.widthIn(max = maxWidth),
            horizontalAlignment = if (own) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(AppSpace.tiny)) {
            if (!own) Text(item.senderName ?: stringResource(R.string.chat_unknown_user),
                modifier = Modifier.padding(start = AppSpace.small),
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                style = MiuixTheme.textStyles.footnote2,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (item.isImage) {
                val bitmap = rememberDataUrlImage(item.content)
                val imageSize = if (bitmap == null) DpSize(CHAT_IMAGE_SIZE, CHAT_IMAGE_SIZE)
                    else {
                        val scale = minOf(220f / bitmap.width, 260f / bitmap.height)
                        DpSize((bitmap.width * scale).coerceAtLeast(64f).dp,
                            (bitmap.height * scale).coerceAtLeast(64f).dp)
                    }
                Column(Modifier.clip(RoundedCornerShape(AppShape.control))
                    .background(surface)
                    .combinedClickable(
                        onClick = { item.content?.let(onPreview) },
                        onLongClick = { if (recallable) onRecall(item) },
                    ), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                    ChatImage(bitmap, imageSize)
                    item.caption?.takeIf(String::isNotBlank)?.let { caption ->
                        Text(caption, color = foreground, style = MiuixTheme.textStyles.body1,
                            modifier = Modifier.width(imageSize.width)
                                .padding(horizontal = AppSpace.small, vertical = AppSpace.tiny))
                    }
                }
            } else {
                Card(cornerRadius = AppShape.field, insideMargin = PaddingValues(0.dp),
                    modifier = if (recallable) Modifier.combinedClickable(
                        onClick = {}, onLongClick = { onRecall(item) },
                    ) else Modifier,
                    colors = CardDefaults.defaultColors(color = surface)) {
                    Text(item.content.orEmpty(), color = foreground,
                        modifier = Modifier.padding(horizontal = AppSpace.page, vertical = AppSpace.medium),
                        style = MiuixTheme.textStyles.body1)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.small),
                modifier = Modifier.padding(horizontal = AppSpace.small)) {
                Text(formatChatTime(item.createdAt),
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    style = MiuixTheme.textStyles.footnote2)
                if (own) {
                    val readByOthers = item.readCount > (if (supervised) 1 else 0)
                    Text(stringResource(if (readByOthers) R.string.chat_read else R.string.chat_sent),
                        color = if (readByOthers) MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        style = MiuixTheme.textStyles.footnote2)
                }
            }
        }
    }
}

@Composable
fun ChatScreen(container: AppContainer, session: SessionUser, scrollBehavior: ScrollBehavior,
    onConversationChanged: (String?) -> Unit, backRequest: Int, refreshRequest: Int,
    conversationLayoutReady: Boolean) {
    var conversations by remember { mutableStateOf<List<ChatConversation>>(emptyList()) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by rememberSaveable(selectedId) { mutableStateOf("") }
    var messagesLoading by remember(selectedId) { mutableStateOf(true) }
    val messageMutex = remember { Mutex() }
    val readThrough = remember { mutableMapOf<String, String>() }
    val lifecycleOwner = LocalLifecycleOwner.current
    var sending by remember { mutableStateOf(false) }
    var showNew by remember { mutableStateOf(false) }
    var showRequests by remember { mutableStateOf(false) }
    /** 长按自己 5 分钟内的消息后，待确认撤回的那条。 */
    var recalling by remember { mutableStateOf<ChatMessage?>(null) }
    var recallVisible by remember { mutableStateOf(false) }
    /** 待发送图片可单独发送，也可与输入的说明组成同一条消息。 */
    var pendingImage by remember(selectedId) { mutableStateOf<String?>(null) }
    var imagePickerTargetId by remember { mutableStateOf<String?>(null) }
    var previewImage by remember { mutableStateOf<String?>(null) }
    var previewVisible by remember { mutableStateOf(false) }
    /** 还有更早的消息可翻；首次拉不到新页就置 false。 */
    var hasMore by remember { mutableStateOf(true) }
    var loadingOlder by remember { mutableStateOf(false) }
    val pickImage = rememberImagePicker(maxItems = 1) { urls ->
        if (imagePickerTargetId == selectedId) urls.firstOrNull()?.let { pendingImage = it }
    }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val imeVisible = WindowInsets.ime.getBottom(density) > 0
    val snackbar = LocalAppSnackbar.current
    val scope = rememberCoroutineScope()
    val messageListState = key(selectedId) { rememberAppListState() }
    var firstMessageLoad by remember(selectedId) { mutableStateOf(true) }
    var messagesPositioned by remember(selectedId) { mutableStateOf(false) }
    val messageEntrance = remember(selectedId) { Animatable(0f) }
    val reduceMotion = LocalEffects.current.reduceMotion
    val glassNavigation = LocalEffects.current.effectiveLevel != EffectsLevel.OFF
    val currentListBottomInset = LocalGlassPageBottomInset.current
    var lastListBottomInset by remember { mutableStateOf(currentListBottomInset) }
    SideEffect {
        if (!conversationLayoutReady) lastListBottomInset = currentListBottomInset
    }
    // Keep the outgoing FAB above the navigation bar after the conversation takes over
    // the shell insets; otherwise it drops into the incoming composer and gets covered.
    val fabBottomInset = if (glassNavigation) lastListBottomInset
        else if (conversationLayoutReady) 64.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        else 0.dp
    LaunchedEffect(messagesPositioned, reduceMotion) {
        if (messagesPositioned) {
            if (reduceMotion) messageEntrance.snapTo(1f)
            else messageEntrance.animateTo(1f, tween(260, easing = FastOutSlowInEasing))
        }
    }
    LaunchedEffect(selectedId, conversationLayoutReady, messages.lastOrNull()?.id) {
        if (selectedId == null || !conversationLayoutReady) return@LaunchedEffect
        if (messages.isNotEmpty() && (firstMessageLoad || messages.last().senderId == session.id ||
            (messageListState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= messages.lastIndex - 2)) {
            val lastVisible = messageListState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            if (firstMessageLoad || messages.lastIndex - lastVisible > 6)
                messageListState.scrollToItem(messages.lastIndex)
            else messageListState.animateScrollToItem(messages.lastIndex)
            if (firstMessageLoad) {
                // Keep the initial list invisible while its anchor is measured. Otherwise
                // the oldest messages can flash for one frame before jumping to the latest.
                withFrameNanos { }
                withFrameNanos { }
                messagesPositioned = true
            }
            firstMessageLoad = false
        }
    }
    val selected = conversations.firstOrNull { it.id == selectedId }
    val chatFallbackTitle = stringResource(R.string.chat)
    var handledBackRequest by remember { mutableIntStateOf(backRequest) }
    var handledRefreshRequest by remember { mutableIntStateOf(refreshRequest) }
    LaunchedEffect(selectedId, selected?.title) {
        onConversationChanged(if (selectedId == null) null else selected?.title ?: chatFallbackTitle)
    }
    LaunchedEffect(backRequest) {
        if (backRequest > handledBackRequest) {
            handledBackRequest = backRequest
            selectedId = null
            messages = emptyList()
        }
    }

    fun loadConversations() {
        scope.launch {
            loading = true; error = null
            when (val result = container.chatRepository.conversations()) {
                is ApiResult.Ok -> {
                    conversations = result.data
                }
                is ApiResult.Err -> error = result.message
            }
            loading = false
        }
    }
    suspend fun loadMessages(id: String) = messageMutex.withLock {
        if (selectedId != id) return@withLock
        when (val result = container.chatRepository.messages(id)) {
            is ApiResult.Ok -> {
                if (selectedId != id) return@withLock
                messages = result.data
                error = null
                result.data.lastOrNull()?.let { last ->
                    if (readThrough[id] != last.id &&
                        container.chatRepository.markRead(id, last.id) is ApiResult.Ok) {
                        readThrough[id] = last.id
                        conversations = conversations.map { if (it.id == id) it.copy(unreadCount = 0) else it }
                    }
                }
            }
            is ApiResult.Err -> if (selectedId == id) error = result.message
        }
        if (selectedId == id) messagesLoading = false
    }
    LaunchedEffect(refreshRequest) {
        if (refreshRequest > handledRefreshRequest) {
            handledRefreshRequest = refreshRequest
            selectedId?.let { loadMessages(it) }
        }
    }
    LaunchedEffect(Unit) { loadConversations() }
    /**
     * 上拉加载更早的一页（服务端每页 50 条，`before` 游标）。
     *
     * 消息项都带稳定 key，向头部插入时 LazyColumn 会按 key 锚定首屏可见项，
     * 所以这里不需要手动 `scrollToItem` 补偿（补了反而会双重校正、位置跳动）。
     */
    suspend fun loadOlder() {
        val id = selectedId ?: return
        if (loadingOlder || !hasMore || messages.isEmpty()) return
        loadingOlder = true
        try {
            when (val result = container.chatRepository.messages(id, before = messages.first().id)) {
                is ApiResult.Ok -> {
                    if (selectedId != id) return
                    val known = messages.mapTo(mutableSetOf()) { it.id }
                    val older = result.data.filterNot { it.id in known }
                    if (older.isEmpty()) hasMore = false else messages = older + messages
                }
                is ApiResult.Err -> if (selectedId == id) snackbar(result.message)
            }
        } finally {
            loadingOlder = false
        }
    }

    // 实时为主、轮询兜底：
    // - 进入会话先取令牌连 Socket.IO，连上后由 chat:event 驱动刷新（不再是每 15 秒盲拉一次）；
    // - 通道没连上（未配置地址 / 鉴权失败 / 连续失败）时兜底轮询继续工作，socket 不通也不影响可用性；
    // - 离开会话或进后台即断开（repeatOnLifecycle(STARTED) + close），符合本项目的省电取向。
    LaunchedEffect(selectedId, lifecycleOwner) {
        val id = selectedId ?: return@LaunchedEffect
        val realtime = container.chatRealtimeClient
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            loadMessages(id)
            realtime.join(id)
            val fallback = launch {
                while (true) {
                    delay(CHAT_POLL_FALLBACK_MILLIS)
                    if (realtime.status.value !is RealtimeStatus.Connected) loadMessages(id)
                }
            }
            try {
                // 通道状态只记日志、界面不区分呈现：观感一致，排查时又有据可依。
                // 用 Log.i 而非 Log.d：HyperOS/MIUI 会丢弃 D 级日志，通道状态恰恰是排查时最需要看的。
                launch {
                    realtime.status.collect { status -> Log.i(CHAT_TAG, "实时通道状态: $status") }
                }
                realtime.events.collect { event ->
                    if (event.conversationId != id) return@collect
                    when (event.type) {
                        ChatRealtimeEvent.TYPE_MESSAGE_CREATED,
                        ChatRealtimeEvent.TYPE_MESSAGE_RECALLED -> loadMessages(id)
                        ChatRealtimeEvent.TYPE_CONVERSATION_CREATED -> loadConversations()
                    }
                }
            } finally {
                fallback.cancel()
                realtime.close()
                Log.d(CHAT_TAG, "关闭会话 $id 的实时通道")
            }
        }
    }
    BackHandler(selectedId != null) { selectedId = null; messages = emptyList() }

    AnimatedContent(
        modifier = Modifier.fillMaxSize().clipToBounds(),
        // Start the incoming animation only once the shell has installed the conversation
        // toolbar/insets; otherwise the first frame uses the list's expanded header geometry.
        targetState = selectedId == null || !conversationLayoutReady,
        transitionSpec = {
            val direction = if (targetState) -1 else 1
            // The list's FAB leaves with this content. Match the bottom bar's duration so
            // it stays visible through the transition instead of vanishing early.
            val duration = if (reduceMotion) 0 else 360
            (fadeIn(tween(duration, easing = FastOutSlowInEasing)) +
                slideInHorizontally(tween(duration, easing = FastOutSlowInEasing)) { direction * it / 8 }) togetherWith
                (fadeOut(tween(duration, easing = FastOutSlowInEasing)) +
                    slideOutHorizontally(tween(duration, easing = FastOutSlowInEasing)) { -direction * it / 8 }) using null
        },
        label = "chat-navigation",
    ) { showingList ->
    if (showingList) {
        Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = rememberAppListState(),
            modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
            contentPadding = glassPagePadding(top = AppSpace.small, bottom = 96.dp),
            verticalArrangement = Arrangement.Top,
        ) {
            item {
                ListHeader(stringResource(R.string.chat_hint), stringResource(R.string.chat_conversations), loading, ::loadConversations)
            }
            // 私聊申请收件箱入口：ADMIN 在里面审批，其他角色看自己申请的状态。
            item {
                BasicComponent(
                    title = stringResource(R.string.chat_requests),
                    summary = stringResource(R.string.chat_requests_summary),
                    onClick = { showRequests = true },
                    endActions = { Icon(MiuixIcons.Basic.ArrowRight, contentDescription = null) },
                )
            }
            when {
                loading && conversations.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
                error != null && conversations.isEmpty() -> item { PageState(stringResource(R.string.load_failed), error, onRetry = ::loadConversations) }
                conversations.isEmpty() -> item { PageState(stringResource(R.string.chat_empty)) }
                else -> itemsIndexed(conversations, key = { _, it -> it.id }, contentType = { _, _ -> "conversation" }) { index, conversation ->
                    GroupedListItem(first = index == 0, last = index == conversations.lastIndex) {
                        BasicComponent(
                            title = conversation.title,
                            summary = (conversation.lastMessage ?: stringResource(R.string.chat_no_messages))
                                .replace('\n', ' ').replace('\r', ' ').take(48),
                            onClick = { messages = emptyList(); error = null; hasMore = true; selectedId = conversation.id },
                            startAction = {
                                Box(Modifier.size(44.dp).clip(CircleShape)
                                    .background(MiuixTheme.colorScheme.primary.copy(alpha = 0.11f)),
                                    contentAlignment = Alignment.Center) {
                                    if (conversation.type == "DIRECT") com.custodysim.app.ui.common.UserAvatar(
                                        conversation.title, conversation.memberAvatars.entries.firstOrNull { it.key != session.id }?.value)
                                    else Icon(MiuixIcons.Messages, contentDescription = null,
                                        modifier = Modifier.size(22.dp), tint = MiuixTheme.colorScheme.primary)
                                }
                            },
                            endActions = {
                                if (conversation.unreadCount > 0) StatusChip(
                                    conversation.unreadCount.toString(), MiuixTheme.colorScheme.primary)
                                else Icon(MiuixIcons.Basic.ArrowRight, contentDescription = null)
                            },
                        )
                        if (index != conversations.lastIndex) HorizontalDivider(
                            modifier = Modifier.padding(start = 76.dp, end = AppSpace.page),
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.10f))
                    }
                }
            }
        }
        ChatRequestsSheet(container = container, session = session, show = showRequests,
            onDismiss = { showRequests = false }, onSnackbar = { message -> snackbar(message) })
        FloatingActionButton(
            onClick = { showNew = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = fabBottomInset)
                .padding(AppSpace.section),
        ) {
            Icon(MiuixIcons.Add, contentDescription = stringResource(R.string.chat_new),
                tint = MiuixTheme.colorScheme.onPrimary)
        }
        }
    } else {
        Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
            error?.let { NoticeBanner(it, error = true) }
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val bubbleMaxWidth = maxWidth * 0.78f
            LazyColumn(state = messageListState,
                modifier = Modifier.fillMaxSize().graphicsLayer {
                    // Draw-only entrance: no per-bubble recomposition or changing list height.
                    alpha = messageEntrance.value
                    translationY = if (reduceMotion) 0f else (1f - messageEntrance.value) * 10.dp.toPx()
                }.pointerInput(focusManager, keyboardController) {
                    detectTapGestures(onTap = {
                        focusManager.clearFocus()
                        keyboardController?.hide()
                    })
                },
                contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                if (loadingOlder) item {
                    Box(Modifier.fillMaxWidth().padding(AppSpace.small), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
                items(messages, key = { it.id }, contentType = { if (it.recalled) "recalled" else if (it.isImage) "image" else "text" }) { item ->
                    ChatBubble(
                        item = item,
                        own = item.senderId == session.id,
                        supervised = session.isSupervised,
                        maxWidth = bubbleMaxWidth,
                        onPreview = { previewImage = it; previewVisible = true },
                        onRecall = { recalling = it; recallVisible = true },
                    )
                }
            }
            // 滚到顶部就继续往前翻页；条目带 key，插入头部不会改变视觉位置。
            LaunchedEffect(messageListState, selectedId) {
                snapshotFlow { messagesPositioned to messageListState.firstVisibleItemIndex }
                    .collect { (positioned, index) -> if (positioned && index == 0) loadOlder() }
            }
            if (messages.isEmpty() && error == null) {
                Column(Modifier.align(Alignment.Center).padding(AppSpace.large),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                    if (messagesLoading) CircularProgressIndicator()
                    else Icon(MiuixIcons.Messages, contentDescription = null,
                        modifier = Modifier.size(36.dp), tint = MiuixTheme.colorScheme.primary)
                    Text(stringResource(if (messagesLoading) R.string.loading else R.string.chat_no_messages),
                        style = MiuixTheme.textStyles.footnote1,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
            }
            }
            HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
            Card(modifier = Modifier.fillMaxWidth().padding(horizontal = AppSpace.page, vertical = AppSpace.small),
                cornerRadius = AppShape.group, insideMargin = PaddingValues(0.dp)) {
            pendingImage?.let { image ->
                Column(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().padding(AppSpace.small), verticalAlignment = Alignment.CenterVertically) {
                        ImageThumbs(listOf(image), modifier = Modifier.weight(1f), onRemove = { pendingImage = null })
                        Text(stringResource(R.string.chat_image_caption_hint),
                            style = MiuixTheme.textStyles.footnote1,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            modifier = Modifier.padding(AppSpace.small))
                    }
                    HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
                }
            }
            Row(Modifier.fillMaxWidth().padding(AppSpace.small),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                FramedTextField(value = message, onValueChange = { message = it },
                    label = stringResource(if (pendingImage == null) R.string.chat_message_hint else R.string.chat_image_caption_hint), minLines = 1, maxLines = 4,
                    modifier = Modifier.weight(1f))
                // 选图即压缩成 data URL（≤1MB，与服务端/Web 端同一约束）。
                IconButton(onClick = {
                    if (sending) return@IconButton
                    val target = selectedId
                    imagePickerTargetId = target
                    focusManager.clearFocus()
                    keyboardController?.hide()
                    scope.launch {
                        // Let the pressed icon and IME settle before Android starts the system picker transition.
                        delay(if (imeVisible) 180 else 90)
                        if (selectedId == target) pickImage()
                    }
                }) {
                    Icon(MiuixIcons.Photos, contentDescription = stringResource(R.string.chat_image),
                        tint = MiuixTheme.colorScheme.primary)
                }
                IconButton(onClick = {
                    val id = selectedId ?: return@IconButton
                    val image = pendingImage
                    val text = message.trim()
                    // 图片与说明一次提交为同一条消息；纯图片同样可发送。
                    if (sending || (image == null && text.isBlank())) return@IconButton
                    sending = true
                    scope.launch {
                        try {
                            messageMutex.withLock {
                                when (val result = container.chatRepository.sendMessage(
                                    id, image ?: text,
                                    if (image != null) ChatMessage.TYPE_IMAGE else ChatMessage.TYPE_TEXT,
                                    if (image != null) text.takeIf { it.isNotBlank() } else null,
                                )) {
                                    is ApiResult.Ok -> {
                                        if (selectedId == id) {
                                            messages = (messages + result.data).distinctBy { it.id }
                                            if (image == null || text.isBlank() || result.data.caption == text) {
                                                message = ""
                                            } else {
                                                snackbar("图片已发送，但服务端未保存说明，请升级服务端后重试")
                                            }
                                            pendingImage = null
                                            error = null
                                        }
                                        loadConversations()
                                    }
                                    is ApiResult.Err -> if (selectedId == id) snackbar(result.message)
                                }
                            }
                        } finally {
                            sending = false
                        }
                    }
                }, enabled = message.isNotBlank() || pendingImage != null,
                    minWidth = 48.dp, minHeight = 48.dp,
                    backgroundColor = if (message.isNotBlank() || pendingImage != null || sending)
                        MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.primary.copy(alpha = 0.10f)) {
                    Icon(MiuixIcons.Send, contentDescription = stringResource(R.string.chat_send),
                        tint = if (message.isNotBlank() || pendingImage != null || sending)
                            MiuixTheme.colorScheme.onPrimary else MiuixTheme.colorScheme.primary)
                }
            }
            }
        }
    }
    }
    if (previewVisible) {
        Dialog(onDismissRequest = { previewVisible = false; previewImage = null },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
            val fullBitmap = rememberFullDataUrlImage(previewImage)
            val bitmap = fullBitmap ?: rememberDataUrlImage(previewImage)
            var zoom by remember(previewImage) { mutableFloatStateOf(1f) }
            var pan by remember(previewImage) { mutableStateOf(Offset.Zero) }
            var viewport by remember { mutableStateOf(IntSize.Zero) }
            val transform = rememberTransformableState { centroid, zoomChange, panChange, _ ->
                val nextZoom = (zoom * zoomChange).coerceIn(1f, 4f)
                val center = Offset(viewport.width / 2f, viewport.height / 2f)
                val focalPoint = if (centroid.x.isFinite() && centroid.y.isFinite()) centroid else center
                pan = if (nextZoom == 1f) Offset.Zero else
                    pan + panChange + (focalPoint - center - pan) * (1f - nextZoom / zoom)
                zoom = nextZoom
            }
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                if (bitmap != null) Image(bitmap, stringResource(R.string.chat_image),
                    modifier = Modifier.fillMaxSize().padding(vertical = 56.dp)
                        .onSizeChanged { viewport = it }
                        .graphicsLayer {
                            scaleX = zoom; scaleY = zoom
                            translationX = pan.x; translationY = pan.y
                        }.transformable(transform),
                    contentScale = ContentScale.Fit)
                else CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                IconButton(onClick = { previewVisible = false; previewImage = null },
                    modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(AppSpace.page),
                    backgroundColor = Color.Black.copy(alpha = 0.45f)) {
                    Icon(MiuixIcons.Basic.ArrowRight, contentDescription = stringResource(R.string.close),
                        modifier = Modifier.graphicsLayer { rotationZ = 180f }, tint = Color.White)
                }
            }
        }
    }
    // 撤回确认：长按气泡触发；服务端会再校验一次（本人 + 未撤回 + 5 分钟内）。
    val pendingRecall = recalling
    OverlaySheet(show = recallVisible, title = stringResource(R.string.chat_recall),
        onDismiss = { recallVisible = false }, onDismissFinished = { recalling = null }) {
        Column(Modifier.fillMaxWidth().padding(AppSpace.page),
            verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            Row(verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                Icon(MiuixIcons.Undo, contentDescription = null,
                    modifier = Modifier.size(AppSpace.section), tint = MiuixTheme.colorScheme.primary)
                Text(stringResource(R.string.chat_recall_confirm), style = MiuixTheme.textStyles.body2,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
            PrimaryAction(text = stringResource(R.string.chat_recall), onClick = {
                val id = selectedId
                val target = pendingRecall
                recallVisible = false
                if (id == null || target == null) return@PrimaryAction
                scope.launch {
                    val result = messageMutex.withLock { container.chatRepository.recallMessage(target.id) }
                    when (result) {
                            is ApiResult.Ok -> {
                                if (selectedId == id) loadMessages(id)
                                loadConversations()
                            }
                            // 超时/已被撤回等情况：提示并刷新，让界面回到服务端的真实状态。
                            is ApiResult.Err -> {
                                snackbar(result.message)
                                if (selectedId == id) loadMessages(id)
                            }
                    }
                }
            })
        }
    }
    NewChatSheet(container, showNew, { showNew = false }) { snackbar("私聊请求已处理"); loadConversations() }
}

@Composable
private fun NewChatSheet(container: AppContainer, show: Boolean, onDismiss: () -> Unit, onCreated: () -> Unit) {
    var candidates by remember { mutableStateOf<List<ChatCandidate>>(emptyList()) }
    var selectedIndex by remember { mutableIntStateOf(0) }
    var reason by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(show) {
        if (!show) return@LaunchedEffect
        loading = true
        error = null
        selectedIndex = 0
        when (val result = container.chatRepository.candidates()) {
            is ApiResult.Ok -> candidates = result.data
            is ApiResult.Err -> error = result.message
        }
        loading = false
    }
    OverlaySheet(show = show, title = stringResource(R.string.chat_new),
        onDismiss = onDismiss, busy = submitting,
        onDismissFinished = { reason = "" }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(AppSpace.page),
            verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            if (loading) CircularProgressIndicator()
            if (candidates.isNotEmpty()) SettingGroup {
                OverlayDropdownPreference(
                    title = stringResource(R.string.chat_target),
                    items = candidates.map { "${it.name} · ${it.roomName ?: "未分配监室"}" },
                    selectedIndex = selectedIndex,
                    enabled = !loading && !submitting,
                    onSelectedIndexChange = { selectedIndex = it }, modifier = Modifier.fillMaxWidth(),
                )
            }
            if (!loading && candidates.isEmpty() && error == null) PageState(stringResource(R.string.chat_no_candidates))
            if (candidates.getOrNull(selectedIndex)?.sameRoom == false) FramedTextField(value = reason, onValueChange = { reason = it }, label = stringResource(R.string.chat_reason), modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MiuixTheme.colorScheme.error) }
            PrimaryAction(stringResource(R.string.chat_create), busy = loading || submitting, enabled = candidates.isNotEmpty() && !loading && !submitting, onClick = {
                val target = candidates.getOrNull(selectedIndex) ?: return@PrimaryAction
                submitting = true
                scope.launch {
                    try {
                    when (val result = container.chatRepository.createDirect(target.id, reason)) {
                        is ApiResult.Ok -> { onDismiss(); onCreated() }
                        is ApiResult.Err -> error = result.message
                    }
                    } finally { submitting = false }
                }
            })
        }
    }
}
