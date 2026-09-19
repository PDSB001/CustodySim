package com.custodysim.app.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun ChatScreen(container: AppContainer, session: SessionUser, scrollBehavior: ScrollBehavior) {
    var conversations by remember { mutableStateOf<List<ChatConversation>>(emptyList()) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var showNew by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val selected = conversations.firstOrNull { it.id == selectedId }

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

    if (selectedId == null) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
            contentPadding = PaddingValues(AppSpace.page), verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
        ) {
            item {
                ListHeader(stringResource(R.string.chat_hint), stringResource(R.string.chat_conversations), loading, ::loadConversations)
                PrimaryAction(stringResource(R.string.chat_new), onClick = { showNew = true })
            }
            when {
                loading && conversations.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
                error != null && conversations.isEmpty() -> item { PageState(stringResource(R.string.load_failed), error, onRetry = ::loadConversations) }
                conversations.isEmpty() -> item { PageState(stringResource(R.string.chat_empty)) }
                else -> items(conversations, key = { it.id }) { conversation ->
                    SettingGroup(modifier = Modifier.clickable { selectedId = conversation.id }) {
                        Row(Modifier.fillMaxWidth().padding(AppSpace.inset), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                            Icon(
                                MiuixIcons.Messages,
                                contentDescription = stringResource(R.string.chat_conversations),
                                modifier = Modifier.size(AppSpace.large),
                                tint = MiuixTheme.colorScheme.primary,
                            )
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AppSpace.tiny)) {
                                Text(conversation.title, style = MiuixTheme.textStyles.body1)
                                Text(conversation.lastMessage ?: stringResource(R.string.chat_no_messages), color = MiuixTheme.colorScheme.onSurfaceVariantSummary, maxLines = 1)
                            }
                            if (conversation.unreadCount > 0) {
                                Text("${conversation.unreadCount}", color = MiuixTheme.colorScheme.primary, style = MiuixTheme.textStyles.footnote1)
                            }
                            Icon(
                                MiuixIcons.Basic.ArrowRight,
                                contentDescription = null,
                                tint = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                        }
                    }
                }
            }
        }
    } else {
        Column(Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = AppSpace.page, vertical = AppSpace.small), verticalAlignment = Alignment.CenterVertically) {
                TextButton(text = stringResource(R.string.back_to_list), onClick = { selectedId = null; messages = emptyList() })
                Text(selected?.title ?: stringResource(R.string.chat), modifier = Modifier.weight(1f), style = MiuixTheme.textStyles.body1)
                TextButton(text = stringResource(R.string.refresh), onClick = { loadMessages(selectedId!!) })
            }
            if (error != null && messages.isEmpty()) PageState(stringResource(R.string.load_failed), error)
            else LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(AppSpace.page), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                items(messages, key = { it.id }) { item ->
                    val own = item.senderId == session.id
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (own) Arrangement.End else Arrangement.Start) {
                        SettingGroup(modifier = Modifier.widthIn(max = AppSpace.contentWidth * 0.82f)) {
                            Column(Modifier.padding(AppSpace.inset), verticalArrangement = Arrangement.spacedBy(AppSpace.tiny)) {
                                if (!own) Text(item.senderName ?: stringResource(R.string.chat_unknown_user), color = MiuixTheme.colorScheme.primary, style = MiuixTheme.textStyles.footnote1)
                                Text(if (item.recalled) stringResource(R.string.chat_recalled) else item.content.orEmpty())
                                Text(item.createdAt, color = MiuixTheme.colorScheme.onSurfaceVariantSummary, style = MiuixTheme.textStyles.footnote1)
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(AppSpace.page), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                TextField(value = message, onValueChange = { message = it }, label = stringResource(R.string.chat_message_hint), enabled = !sending, modifier = Modifier.weight(1f))
                CompactAction(stringResource(if (sending) R.string.sending else R.string.chat_send), enabled = message.isNotBlank() && !sending) {
                    val id = selectedId ?: return@CompactAction
                    scope.launch {
                        sending = true
                        when (val result = container.chatRepository.sendMessage(id, message.trim())) {
                            is ApiResult.Ok -> { messages = messages + result.data; message = ""; loadConversations() }
                            is ApiResult.Err -> error = result.message
                        }
                        sending = false
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
            if (candidates.isNotEmpty()) OverlayDropdownPreference(
                title = stringResource(R.string.chat_target), summary = candidates[selectedIndex.coerceIn(candidates.indices)].name,
                items = candidates.map { "${it.name} · ${it.roomName ?: "未分配监室"}" }, selectedIndex = selectedIndex,
                onSelectedIndexChange = { selectedIndex = it }, modifier = Modifier.fillMaxWidth(),
            )
            if (candidates.getOrNull(selectedIndex)?.sameRoom == false) TextField(value = reason, onValueChange = { reason = it }, label = stringResource(R.string.chat_reason), modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MiuixTheme.colorScheme.error) }
            PrimaryAction(stringResource(R.string.chat_create), enabled = candidates.isNotEmpty(), onClick = {
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
