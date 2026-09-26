package com.custodysim.app.data.chat

import com.custodysim.app.config.AppConfig
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

data class ChatConversation(
    val id: String,
    val type: String,
    val title: String,
    val members: List<String>,
    val lastMessage: String?,
    val unreadCount: Int,
    val memberAvatars: Map<String, String?> = emptyMap(),
)
data class ChatMessage(
    val id: String,
    val senderId: String?,
    val senderName: String?,
    val type: String,
    val content: String?,
    val caption: String?,
    val recalled: Boolean,
    val createdAt: String,
    val readCount: Int,
    val senderAvatar: String? = null,
    /**
     * 乐观发送的本地占位消息（id 形如 `local-*`，只存在于内存）。
     * 服务端确认后会被正式消息替换；失败则移除，并把草稿还回输入框。
     */
    val pending: Boolean = false,
) {
    /** 图片消息的 [content] 是 data URL（单张，≤ 1 MB）。 */
    val isImage: Boolean get() = type == TYPE_IMAGE

    /**
     * 本端要不要显示"撤回"：自己发的、未撤回、且在 5 分钟窗口内。
     *
     * 服务端 `canRecallChatMessage` 才是权威（还有 403/409 复核），这里只驱动按钮显示；
     * 本地时钟偏差导致的越界由服务端拒绝后刷新列表兜底。
     */
    fun canRecall(selfUserId: String, nowMillis: Long = System.currentTimeMillis()): Boolean {
        // 还没被服务端确认的占位消息没有正式 id，不能撤回。
        if (pending || recalled || senderId != selfUserId) return false
        val sentAtMillis =
            runCatching { Instant.parse(createdAt).toEpochMilli() }.getOrNull() ?: return false
        return nowMillis - sentAtMillis <= RECALL_WINDOW_MILLIS
    }

    companion object {
        const val TYPE_TEXT = "TEXT"
        const val TYPE_IMAGE = "IMAGE"

        /** 与服务端 `CHAT_RECALL_WINDOW_MS` 保持一致。 */
        const val RECALL_WINDOW_MILLIS = 5 * 60 * 1000L
    }
}

/** 跨监室私聊申请（`GET /api/chat/requests`）。 */
data class ChatRequest(
    val id: String,
    val status: String,
    val requesterId: String,
    val requesterName: String,
    val targetId: String,
    val targetName: String,
    val reason: String?,
    val reviewComment: String?,
    val reviewedAt: String?,
    val createdAt: String,
) {
    val isPending: Boolean get() = status == "PENDING"
}

/** 实时通道凭证：只对单个会话有效，且约 300 秒后服务端会强制断连。 */
data class RealtimeToken(val token: String, val expiresInSeconds: Int)

data class ChatCandidate(val id: String, val name: String, val roomName: String?, val sameRoom: Boolean)

class ChatRepository(private val api: ApiClient) {
    suspend fun conversations(): ApiResult<List<ChatConversation>> = when (val result = api.getArray("/api/chat/conversations")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            val members = item.optJSONArray("members")?.let { values -> (0 until values.length()).map { values.getJSONObject(it).optString("name") } } ?: emptyList()
            val avatars = item.optJSONArray("members")?.let { values -> (0 until values.length()).associate {
                val member = values.getJSONObject(it)
                member.optString("id") to member.optString("avatar").takeIf { value -> value.isNotBlank() && value != "null" }
            } } ?: emptyMap()
            ChatConversation(item.optString("id"), item.optString("type"), item.optString("title"), members, item.optJSONObject("lastMessage")?.optString("content"), item.optInt("unreadCount"), avatars)
        })
    }

    /** 拉取会话消息；传 [before] 时取它之前的一页（服务端每页 50 条，按时间正序返回）。 */
    suspend fun messages(
        conversationId: String,
        before: String? = null,
    ): ApiResult<List<ChatMessage>> {
        val cursor = before?.takeIf { it.isNotBlank() }?.let { "?before=$it" }.orEmpty()
        return when (val result = api.getArray(AppConfig.pathChatMessages(conversationId) + cursor)) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> ApiResult.Ok(parseMessages(result.data))
        }
    }

    /**
     * 发消息。
     *
     * [type] 取 [ChatMessage.TYPE_TEXT]（正文纯文本 ≤ 4000 字）或 [ChatMessage.TYPE_IMAGE]
     * （正文是单张图片的 data URL，jpeg/png/webp 且压缩后 ≤ 1 MB）。
     */
    suspend fun sendMessage(
        conversationId: String,
        content: String,
        type: String = ChatMessage.TYPE_TEXT,
        caption: String? = null,
    ): ApiResult<ChatMessage> = when (
        val result = api.post(
            AppConfig.pathChatMessages(conversationId),
            JSONObject().put("type", type).put("content", content)
                .apply { if (type == ChatMessage.TYPE_IMAGE && !caption.isNullOrBlank()) put("caption", caption) },
        )
    ) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok(parseMessage(result.data))
    }

    /** 撤回自己 5 分钟内发出的消息；失败（超时/他人消息）按 Err 返回，由调用方刷新列表。 */
    suspend fun recallMessage(messageId: String): ApiResult<JSONObject> =
        api.post(AppConfig.pathChatRecall(messageId))

    suspend fun markRead(conversationId: String, messageId: String): ApiResult<JSONObject> =
        api.post(AppConfig.pathChatRead(conversationId), JSONObject().put("messageId", messageId))

    suspend fun candidates(): ApiResult<List<ChatCandidate>> = when (val result = api.getArray(AppConfig.PATH_CHAT_CANDIDATES)) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            ChatCandidate(item.optString("id"), item.optString("name"), item.optString("roomName").takeIf { it.isNotBlank() && it != "null" }, item.optBoolean("sameRoom"))
        })
    }

    suspend fun createDirect(targetId: String, reason: String?): ApiResult<JSONObject> = api.post(AppConfig.PATH_CHAT_CONVERSATIONS, JSONObject().put("kind", "DIRECT").put("targetUserId", targetId).apply { if (!reason.isNullOrBlank()) put("reason", reason) })

    /**
     * 私聊申请列表。
     *
     * 服务端按角色收敛：管理员看到全部（主要用来审批），被监管人只看到与自己相关的
     * （用来查看"待审批 / 已批准 / 已拒绝"）。客户端不要自行放宽范围。
     */
    suspend fun requests(): ApiResult<List<ChatRequest>> = when (val result = api.getArray(AppConfig.PATH_CHAT_REQUESTS)) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { index ->
            val item = result.data.getJSONObject(index)
            ChatRequest(
                id = item.optString("id"),
                status = item.optString("status"),
                requesterId = item.optString("requesterId"),
                requesterName = item.optString("requesterName").ifBlank { "未知用户" },
                targetId = item.optString("targetId"),
                targetName = item.optString("targetName").ifBlank { "未知用户" },
                reason = item.optString("reason").takeIf { it.isNotBlank() && it != "null" },
                reviewComment = item.optString("reviewComment").takeIf { it.isNotBlank() && it != "null" },
                reviewedAt = item.optString("reviewedAt").takeIf { it.isNotBlank() && it != "null" },
                createdAt = item.optString("createdAt"),
            )
        })
    }

    /** 审批跨监室私聊：仅管理员可用（服务端另有 403 兜底）。 */
    suspend fun reviewRequest(
        requestId: String,
        approve: Boolean,
        comment: String? = null,
    ): ApiResult<JSONObject> = api.patch(
        AppConfig.pathChatRequestReview(requestId),
        JSONObject()
            .put("result", if (approve) "APPROVED" else "REJECTED")
            .apply { comment?.trim()?.takeIf { it.isNotEmpty() }?.let { put("comment", it) } },
    )

    /** 换取实时通道令牌：单次只对一个会话有效，约 300 秒后服务端强制断连。 */
    suspend fun realtimeToken(conversationId: String): ApiResult<RealtimeToken> = when (
        val result = api.post(
            AppConfig.PATH_CHAT_REALTIME_TOKEN,
            JSONObject().put("conversationId", conversationId),
        )
    ) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok(
            RealtimeToken(
                token = result.data.optString("token"),
                expiresInSeconds = result.data.optInt("expiresInSeconds", 300),
            ),
        )
    }

    private fun parseMessages(array: JSONArray): List<ChatMessage> = (0 until array.length()).map { parseMessage(array.getJSONObject(it)) }
    private fun parseMessage(item: JSONObject): ChatMessage = ChatMessage(
        id = item.optString("id"),
        senderId = item.optString("senderId").takeIf { it.isNotBlank() && it != "null" },
        senderName = item.optString("senderName").takeIf { it.isNotBlank() && it != "null" },
        senderAvatar = item.optString("senderAvatar").takeIf { it.isNotBlank() && it != "null" },
        // 老数据/老服务端可能不带 type，缺省按文本处理。
        type = item.optString("type").ifBlank { ChatMessage.TYPE_TEXT },
        content = item.optString("content").takeIf { it.isNotBlank() && it != "null" },
        caption = item.optString("caption").takeIf { it.isNotBlank() && it != "null" },
        recalled = !item.isNull("recalledAt"),
        createdAt = item.optString("createdAt"),
        readCount = item.optInt("readCount"),
    )
}
