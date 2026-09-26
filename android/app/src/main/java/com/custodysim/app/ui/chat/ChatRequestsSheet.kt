package com.custodysim.app.ui.chat

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.chat.ChatRequest
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.FramedTextField
import com.custodysim.app.ui.common.OverlaySheet
import com.custodysim.app.ui.common.PageState
import com.custodysim.app.ui.common.StatusChip
import com.custodysim.app.ui.common.statusColor
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 私聊申请收件箱。
 *
 * 角色分流（服务端 `GET /api/chat/requests` 已按角色收敛数据范围，客户端不要放宽）：
 * - **ADMIN**：可批准/拒绝待审批的跨监室私聊申请，附一条最多 500 字的意见；
 * - **其他角色**：只读，看到与自己相关的申请及其状态（待审批 / 已批准 / 已拒绝）。
 *
 * 弹层内容区高度按屏幕比例固定（`bodyFraction`）：加载态、空态与长列表之间切换时高度不跳变。
 */
@Composable
fun ChatRequestsSheet(
    container: AppContainer,
    session: SessionUser,
    show: Boolean,
    onDismiss: () -> Unit,
    onSnackbar: (String) -> Unit,
) {
    // 服务端对非 ADMIN 的审批请求一律 403，所以客户端也不该先给出可点的审批入口。
    val canReview = session.role == "ADMIN"
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var requests by remember { mutableStateOf<List<ChatRequest>>(emptyList()) }
    /** 正在提交审批的申请 id：提交期间禁用所有审批按钮，避免重复点击。 */
    var reviewing by remember { mutableStateOf<String?>(null) }
    /** 本次审批共用的意见（可选）。 */
    var comment by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    // stringResource 只能在组合里调用，先取出来供协程回调使用。
    val approvedToast = stringResource(R.string.chat_request_approved_toast)
    val rejectedToast = stringResource(R.string.chat_request_rejected_toast)

    suspend fun load() {
        loading = true
        try {
            when (val result = container.chatRepository.requests()) {
                is ApiResult.Ok -> {
                    requests = result.data
                    error = null
                }
                is ApiResult.Err -> error = result.message
            }
        } finally {
            loading = false
        }
    }

    suspend fun review(request: ChatRequest, approve: Boolean) {
        if (reviewing != null) return
        reviewing = request.id
        try {
            when (val result = container.chatRepository.reviewRequest(request.id, approve, comment)) {
                is ApiResult.Ok -> {
                    comment = ""
                    onSnackbar(if (approve) approvedToast else rejectedToast)
                    // 审批会改变状态与可审批范围，重拉一次比本地改动更可靠。
                    load()
                }
                // 边界情况（已被他人处理、超出 5 分钟窗口等）由服务端兜底，失败后同样重拉对齐状态。
                is ApiResult.Err -> {
                    onSnackbar(result.message)
                    load()
                }
            }
        } finally {
            reviewing = null
        }
    }

    LaunchedEffect(show) {
        if (show) {
            comment = ""
            load()
        }
    }

    OverlaySheet(
        show = show,
        title = stringResource(R.string.chat_requests),
        onDismiss = onDismiss,
        busy = reviewing != null,
        bodyFraction = 0.6f,
    ) {
        when {
            loading && requests.isEmpty() -> PageState(stringResource(R.string.loading), loading = true)
            error != null && requests.isEmpty() -> PageState(
                stringResource(R.string.load_failed), error, onRetry = { scope.launch { load() } })
            requests.isEmpty() -> PageState(stringResource(R.string.chat_requests_empty))
            else -> Column(Modifier.fillMaxSize()) {
                if (canReview) {
                    Box(Modifier.padding(horizontal = AppSpace.page, vertical = AppSpace.small)) {
                        FramedTextField(value = comment, onValueChange = { comment = it.take(500) },
                            label = stringResource(R.string.chat_request_comment_hint),
                            minLines = 1, maxLines = 3, enabled = reviewing == null,
                            modifier = Modifier.fillMaxWidth())
                    }
                }
                LazyColumn(modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.small),
                    verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                    items(requests, key = { it.id }, contentType = { "request" }) { request ->
                        Card(modifier = Modifier.fillMaxWidth(), cornerRadius = AppShape.group,
                            insideMargin = PaddingValues(0.dp)) {
                            Column(Modifier.fillMaxWidth().padding(AppSpace.page),
                                verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                                Row(Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                                    Text(stringResource(R.string.chat_request_pair,
                                        request.requesterName, request.targetName),
                                        modifier = Modifier.weight(1f),
                                        style = MiuixTheme.textStyles.body1)
                                    StatusChip(stringResource(requestStatusLabel(request.status)),
                                        statusColor(request.status))
                                }
                                request.reason?.let {
                                    Text(stringResource(R.string.chat_request_reason, it),
                                        style = MiuixTheme.textStyles.footnote1,
                                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                }
                                Text(formatChatTime(request.createdAt),
                                    style = MiuixTheme.textStyles.footnote2,
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                request.reviewComment?.let {
                                    Text(stringResource(R.string.chat_request_comment, it),
                                        style = MiuixTheme.textStyles.footnote1,
                                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                }
                                if (canReview && request.isPending) {
                                    HorizontalDivider(color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
                                    Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                                        TextButton(text = stringResource(R.string.chat_request_approve),
                                            enabled = reviewing == null,
                                            onClick = { scope.launch { review(request, true) } },
                                            colors = ButtonDefaults.textButtonColorsPrimary())
                                        TextButton(text = stringResource(R.string.chat_request_reject),
                                            enabled = reviewing == null,
                                            onClick = { scope.launch { review(request, false) } },
                                            colors = ButtonDefaults.textButtonColors(
                                                textColor = MiuixTheme.colorScheme.error))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 申请状态文案（与服务端 status 取值一一对应）。 */
@StringRes
private fun requestStatusLabel(status: String): Int = when (status) {
    "APPROVED" -> R.string.chat_request_status_approved
    "REJECTED" -> R.string.chat_request_status_rejected
    else -> R.string.chat_request_status_pending
}
