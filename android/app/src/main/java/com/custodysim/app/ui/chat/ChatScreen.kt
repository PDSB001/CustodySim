package com.custodysim.app.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.chat.*
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.basic.ArrowRight
import top.yukonga.miuix.kmp.icon.extended.Messages
import top.yukonga.miuix.kmp.icon.extended.Add
import top.yukonga.miuix.kmp.icon.extended.Send
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun ChatScreen(container: AppContainer, session: SessionUser, scrollBehavior: ScrollBehavior,
    onConversationChanged: (String?) -> Unit, backRequest: Int, refreshRequest: Int) {
    var conversations by remember { mutableStateOf<List<ChatConversation>>(emptyList()) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var showNew by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val messageListState = rememberLazyListState()
    var firstMessageLoad by remember(selectedId) { mutableStateOf(true) }
    LaunchedEffect(messages.lastOrNull()?.id) {
        if (messages.isNotEmpty() && (firstMessageLoad || messages.last().senderId == session.id ||
            (messageListState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= messages.lastIndex - 2)) {
            messageListState.animateScrollToItem(messages.lastIndex)
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
    fun loadMessages(id: String) = scope.launch {
        when (val result = container.chatRepository.messages(id)) {
            is ApiResult.Ok -> {
                messages = result.data
                result.data.lastOrNull()?.let { container.chatRepository.markRead(id, it.id) }
            }
            is ApiResult.Err -> error = result.message
        }
    }
    LaunchedEffect(refreshRequest) {
        if (refreshRequest > handledRefreshRequest) {
            handledRefreshRequest = refreshRequest
            selectedId?.let { loadMessages(it) }
        }
    }
    LaunchedEffect(Unit) { loadConversations() }
    LaunchedEffect(selectedId) { selectedId?.let { loadMessages(it) } }
    LaunchedEffect(selectedId) {
        while (selectedId != null) {
            delay(15_000)
            val id = selectedId ?: break
            when (val result = container.chatRepository.messages(id)) {
                is ApiResult.Ok -> {
                    messages = result.data
                    result.data.lastOrNull()?.let { container.chatRepository.markRead(id, it.id) }
                }
                is ApiResult.Err -> Unit
            }
        }
    }
    BackHandler(selectedId != null) { selectedId = null; messages = emptyList() }

    AnimatedContent(
        targetState = selectedId == null,
        transitionSpec = {
            val direction = if (targetState) -1 else 1
            (fadeIn(tween(220)) + slideInHorizontally(tween(220)) { direction * it / 10 }) togetherWith
                (fadeOut(tween(160)) + slideOutHorizontally(tween(160)) { -direction * it / 10 })
        },
        label = "chat-navigation",
    ) { showingList ->
    if (showingList) {
        Box(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
            contentPadding = PaddingValues(start = AppSpace.page, end = AppSpace.page,
                top = AppSpace.small, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
        ) {
            item {
                ListHeader(stringResource(R.string.chat_hint), stringResource(R.string.chat_conversations), loading, ::loadConversations)
            }
            when {
                loading && conversations.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
                error != null && conversations.isEmpty() -> item { PageState(stringResource(R.string.load_failed), error, onRetry = ::loadConversations) }
                conversations.isEmpty() -> item { PageState(stringResource(R.string.chat_empty)) }
                else -> items(conversations, key = { it.id }) { conversation ->
                    SettingGroup {
                        BasicComponent(
                            title = conversation.title,
                            summary = (conversation.lastMessage ?: stringResource(R.string.chat_no_messages)).take(80),
                            onClick = { messages = emptyList(); error = null; selectedId = conversation.id },
                            startAction = {
                                Box(Modifier.size(44.dp).clip(CircleShape)
                                    .background(MiuixTheme.colorScheme.primary.copy(alpha = 0.11f)),
                                    contentAlignment = Alignment.Center) {
                                    Icon(MiuixIcons.Messages, contentDescription = null,
                                        modifier = Modifier.size(22.dp), tint = MiuixTheme.colorScheme.primary)
                                }
                            },
                            endActions = {
                                if (conversation.unreadCount > 0) StatusChip(
                                    conversation.unreadCount.toString(), MiuixTheme.colorScheme.primary)
                                else Icon(MiuixIcons.Basic.ArrowRight, contentDescription = null)
                            },
                        )
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = { showNew = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(AppSpace.section),
        ) {
            Icon(MiuixIcons.Add, contentDescription = stringResource(R.string.chat_new),
                tint = MiuixTheme.colorScheme.onPrimary)
        }
        }
    } else {
        Column(Modifier.fillMaxSize().imePadding()) {
            error?.let { NoticeBanner(it, error = true) }
            LazyColumn(state = messageListState, modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                items(messages, key = { it.id }) { item ->
                    val own = item.senderId == session.id
                    BoxWithConstraints(Modifier.fillMaxWidth()) {
                        val bubbleMaxWidth = this.maxWidth * 0.78f
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (own) Arrangement.End else Arrangement.Start) {
                            Column(Modifier.widthIn(max = bubbleMaxWidth),
                                horizontalAlignment = if (own) Alignment.End else Alignment.Start,
                                verticalArrangement = Arrangement.spacedBy(AppSpace.tiny)) {
                                if (!own) Text(item.senderName ?: stringResource(R.string.chat_unknown_user),
                                    modifier = Modifier.padding(start = AppSpace.small),
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                                    style = MiuixTheme.textStyles.footnote2)
                                Card(cornerRadius = AppShape.field, insideMargin = PaddingValues(0.dp),
                                    colors = CardDefaults.defaultColors(color = if (own)
                                        MiuixTheme.colorScheme.primary.copy(alpha = 0.12f)
                                        else MiuixTheme.colorScheme.background)) {
                                    Text(if (item.recalled) stringResource(R.string.chat_recalled) else item.content.orEmpty(),
                                        modifier = Modifier.padding(horizontal = AppSpace.page, vertical = AppSpace.medium),
                                        style = MiuixTheme.textStyles.body1)
                                }
                                Text(item.createdAt.replace('T', ' ').take(16),
                                    modifier = Modifier.padding(horizontal = AppSpace.small),
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                                    style = MiuixTheme.textStyles.footnote2)
                            }
                        }
                    }
                }
            }
            HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
            Row(Modifier.fillMaxWidth().padding(horizontal = AppSpace.page, vertical = AppSpace.small),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                FramedTextField(value = message, onValueChange = { message = it },
                    label = stringResource(R.string.chat_message_hint), minLines = 1, maxLines = 4,
                    enabled = !sending, modifier = Modifier.weight(1f))
                IconButton(onClick = {
                    val id = selectedId ?: return@IconButton
                    scope.launch {
                        sending = true
                        when (val result = container.chatRepository.sendMessage(id, message.trim())) {
                            is ApiResult.Ok -> { messages = messages + result.data; message = ""; loadConversations() }
                            is ApiResult.Err -> error = result.message
                        }
                        sending = false
                    }
                }, enabled = message.isNotBlank() && !sending,
                    minWidth = 48.dp, minHeight = 48.dp,
                    backgroundColor = if (message.isNotBlank() && !sending)
                        MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.primary.copy(alpha = 0.10f)) {
                    Icon(MiuixIcons.Send, contentDescription = stringResource(R.string.chat_send),
                        tint = if (message.isNotBlank() && !sending)
                            MiuixTheme.colorScheme.onPrimary else MiuixTheme.colorScheme.primary)
                }
            }
        }
    }
    }
    NewChatSheet(container, showNew, { showNew = false }) { loadConversations() }
}

@Composable
private fun NewChatSheet(container: AppContainer, show: Boolean, onDismiss: () -> Unit, onCreated: () -> Unit) {
    var candidates by remember(show) { mutableStateOf<List<ChatCandidate>>(emptyList()) }
    var selectedIndex by remember(show) { mutableIntStateOf(0) }
    var reason by remember { mutableStateOf("") }
    var loading by remember(show) { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(show) {
        if (!show) return@LaunchedEffect
        loading = true
        when (val result = container.chatRepository.candidates()) {
            is ApiResult.Ok -> candidates = result.data
            is ApiResult.Err -> error = result.message
        }
        loading = false
    }
    OverlayDialog(show = show, title = stringResource(R.string.chat_new), onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            if (loading) CircularProgressIndicator()
            if (candidates.isNotEmpty()) SettingGroup {
                OverlayDropdownPreference(
                    title = stringResource(R.string.chat_target),
                    items = candidates.map { "${it.name} · ${it.roomName ?: "未分配监室"}" },
                    selectedIndex = selectedIndex,
                    onSelectedIndexChange = { selectedIndex = it }, modifier = Modifier.fillMaxWidth(),
                )
            }
            if (!loading && candidates.isEmpty() && error == null) PageState(stringResource(R.string.chat_no_candidates))
            if (candidates.getOrNull(selectedIndex)?.sameRoom == false) FramedTextField(value = reason, onValueChange = { reason = it }, label = stringResource(R.string.chat_reason), modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MiuixTheme.colorScheme.error) }
            PrimaryAction(stringResource(R.string.chat_create), busy = loading, enabled = candidates.isNotEmpty(), onClick = {
                val target = candidates.getOrNull(selectedIndex) ?: return@PrimaryAction
                scope.launch {
                    loading = true
                    when (val result = container.chatRepository.createDirect(target.id, reason)) {
                        is ApiResult.Ok -> { onDismiss(); onCreated(); reason = "" }
                        is ApiResult.Err -> error = result.message
                    }
                    loading = false
                }
            })
        }
    }
}
