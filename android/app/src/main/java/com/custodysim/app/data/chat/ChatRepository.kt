package com.custodysim.app.data.chat

import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject

data class ChatConversation(
    val id: String,
    val type: String,
    val title: String,
    val members: List<String>,
    val lastMessage: String?,
    val unreadCount: Int,
)
data class ChatMessage(
    val id: String,
    val senderId: String?,
    val senderName: String?,
    val content: String?,
    val recalled: Boolean,
    val createdAt: String,
    val readCount: Int,
)
data class ChatCandidate(val id: String, val name: String, val roomName: String?, val sameRoom: Boolean)

class ChatRepository(private val api: ApiClient) {
    suspend fun conversations(): ApiResult<List<ChatConversation>> = when (val result = api.getArray("/api/chat/conversations")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            val members = item.optJSONArray("members")?.let { values -> (0 until values.length()).map { values.getJSONObject(it).optString("name") } } ?: emptyList()
            ChatConversation(item.optString("id"), item.optString("type"), item.optString("title"), members, item.optJSONObject("lastMessage")?.optString("content"), item.optInt("unreadCount"))
        })
    }

    suspend fun messages(conversationId: String): ApiResult<List<ChatMessage>> = when (val result = api.getArray("/api/chat/conversations/$conversationId/messages")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok(parseMessages(result.data))
    }

    suspend fun sendMessage(conversationId: String, content: String): ApiResult<ChatMessage> = when (val result = api.post("/api/chat/conversations/$conversationId/messages", JSONObject().put("content", content))) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok(parseMessage(result.data))
    }

    suspend fun markRead(conversationId: String, messageId: String): ApiResult<JSONObject> = api.post("/api/chat/conversations/$conversationId/read", JSONObject().put("messageId", messageId))

    suspend fun candidates(): ApiResult<List<ChatCandidate>> = when (val result = api.getArray("/api/chat/candidates")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            ChatCandidate(item.optString("id"), item.optString("name"), item.optString("roomName").takeIf { it.isNotBlank() && it != "null" }, item.optBoolean("sameRoom"))
        })
    }

    suspend fun createDirect(targetId: String, reason: String?): ApiResult<JSONObject> = api.post("/api/chat/conversations", JSONObject().put("kind", "DIRECT").put("targetUserId", targetId).apply { if (!reason.isNullOrBlank()) put("reason", reason) })

    private fun parseMessages(array: JSONArray): List<ChatMessage> = (0 until array.length()).map { parseMessage(array.getJSONObject(it)) }
    private fun parseMessage(item: JSONObject): ChatMessage = ChatMessage(item.optString("id"), item.optString("senderId").takeIf { it.isNotBlank() && it != "null" }, item.optString("senderName").takeIf { it.isNotBlank() && it != "null" }, item.optString("content").takeIf { it.isNotBlank() && it != "null" }, !item.isNull("recalledAt"), item.optString("createdAt"), item.optInt("readCount"))
}
