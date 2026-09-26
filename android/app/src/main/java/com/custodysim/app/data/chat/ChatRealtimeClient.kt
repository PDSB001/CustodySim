package com.custodysim.app.data.chat

import com.custodysim.app.config.AppConfig
import com.custodysim.app.data.net.ApiResult
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Duration.Companion.milliseconds
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

/** 实时通道状态：上层据此决定是否降级到轮询（UI 不区分呈现，只记日志）。 */
sealed interface RealtimeStatus {
    data object Idle : RealtimeStatus
    data object Connecting : RealtimeStatus
    data object Connected : RealtimeStatus
    data class Failed(val reason: String) : RealtimeStatus
}

/** 服务端下行事件（与 `realtime-server.mjs` 的 `chat:event` 对齐）。 */
data class ChatRealtimeEvent(
    val type: String,
    val conversationId: String,
    val messageId: String?,
) {
    companion object {
        const val TYPE_MESSAGE_CREATED = "message.created"
        const val TYPE_MESSAGE_RECALLED = "message.recalled"
        const val TYPE_CONVERSATION_CREATED = "conversation.created"
    }
}

/**
 * 聊天实时通道：Engine.IO v4 + Socket.IO v5 的最小实现，只跑在现有 OkHttp 上，不新增依赖。
 *
 * 为什么自实现而不是引入官方 socket.io 客户端：本项目只需要「单会话鉴权 + 加入/退出 + 一个下行事件」，
 * 官方库会带进 okhttp 传递依赖与额外体积，而 release 已开启 R8 + 资源收缩（历史上出现过被 R8 裁掉
 * 反射入口导致启动崩溃），自实现把协议面收敛到可见的几十行里。
 *
 * 协议要点（详见 docs/android-client.md 第 6 节）：
 * - 握手：`GET {realtimeUrl}/socket.io/?EIO=4&transport=websocket`，服务端先发 `0{...}`；
 * - 鉴权：紧接着发 Socket.IO CONNECT 包 `40{"token":"<jwt>"}`，令牌由 [tokenProvider] 换取；
 * - 心跳：服务端发 Engine.IO ping `2`，客户端必须回 `3`；
 * - 加入会话：`42<ackId>["conversation:join","<conversationId>"]`，ack 为 `43<ackId>[{"ok":true}]`；
 * - 令牌只对一个会话有效且约 300 秒过期，到期服务端强制断连 → 这里提前 [REFRESH_LEAD_SECONDS] 秒换新重连。
 */
class ChatRealtimeClient(
    private val tokenProvider: suspend (String) -> ApiResult<RealtimeToken>,
    private val baseUrl: String = AppConfig.realtimeUrl,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _events = MutableSharedFlow<ChatRealtimeEvent>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<ChatRealtimeEvent> = _events

    private val _status = MutableStateFlow<RealtimeStatus>(RealtimeStatus.Idle)
    val status: StateFlow<RealtimeStatus> = _status

    private val ackIds = AtomicInteger(1)
    private val joinAcks = ConcurrentHashMap<Int, (Boolean) -> Unit>()

    @Volatile
    private var socket: WebSocket? = null

    @Volatile
    private var currentConversationId: String? = null

    private var sessionJob: Job? = null

    /**
     * 连接并加入会话；重复调用同一会话时无操作。
     *
     * 失败不会抛异常：状态变成 [RealtimeStatus.Failed]，由上层继续用轮询兜底。
     */
    @Volatile private var disposed = false

    fun dispose() { disposed = true; close(); scope.cancel(); httpClient.dispatcher.cancelAll() }

    fun join(conversationId: String) {
        if (disposed) return
        if (currentConversationId == conversationId && _status.value is RealtimeStatus.Connected) return
        leave()
        currentConversationId = conversationId
        sessionJob?.cancel()
        sessionJob = scope.launch { runSession(conversationId) }
    }

    /** 退出当前会话（不断开信道，供切会话时复用）。 */
    fun leave() {
        val id = currentConversationId ?: return
        emitEvent("conversation:leave", id, ack = null)
        currentConversationId = null
    }

    /** 断开并停止重连：进后台或离开聊天页时调用，符合本项目省电取向。 */
    fun close() {
        sessionJob?.cancel()
        sessionJob = null
        currentConversationId = null
        socket?.close(NORMAL_CLOSURE, null)
        socket = null
        joinAcks.clear()
        _status.value = RealtimeStatus.Idle
    }

    private suspend fun runSession(conversationId: String) {
        if (baseUrl.isBlank()) {
            _status.value = RealtimeStatus.Failed("未配置实时通道地址")
            return
        }
        var attempt = 0
        while (true) {
            val token = fetchToken(conversationId)
            if (token == null) {
                _status.value = RealtimeStatus.Failed("无法取得实时通道凭证")
                return
            }
            _status.value = RealtimeStatus.Connecting
            val closed = CompletableDeferred<Unit>()
            val joined = CompletableDeferred<Boolean>()
            val ws = httpClient.newWebSocket(
                Request.Builder().url("$baseUrl$WS_PATH").build(),
                listener(conversationId, token, closed, joined),
            )
            socket = ws
            // 令牌到期前主动换新重连；服务端也会在 exp 时刻强制断连。
            val refreshDelay = (token.expiresInSeconds - REFRESH_LEAD_SECONDS).coerceAtLeast(30).toLong()
            scope.launch {
                delay(refreshDelay.seconds)
                ws.close(NORMAL_CLOSURE, "token-refresh")
            }
            closed.await()
            joinAcks.clear()
            socket = null
            if (currentConversationId != conversationId) return // 已切走会话或被 close()
            if (joined.isCompleted && joined.await()) {
                // 加入成功过：本次断开是令牌轮换或服务端正常关闭，立即重连、不进入退避。
                attempt = 0
                _status.value = RealtimeStatus.Connecting
                continue
            }
            attempt += 1
            if (attempt > MAX_ATTEMPTS) {
                _status.value = RealtimeStatus.Failed("实时通道连续失败 $attempt 次")
                return
            }
            _status.value = RealtimeStatus.Connecting
            delay(backoffMillis(attempt).milliseconds)
        }
    }

    private suspend fun fetchToken(conversationId: String): RealtimeToken? =
        when (val result = tokenProvider(conversationId)) {
            is ApiResult.Ok -> result.data.takeIf { it.token.isNotBlank() }
            is ApiResult.Err -> null
        }

    private fun listener(
        conversationId: String,
        token: RealtimeToken,
        closed: CompletableDeferred<Unit>,
        joined: CompletableDeferred<Boolean>,
    ) = object : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            // Engine.IO 握手由服务端先推 `0{...}`，收到后再发 Socket.IO CONNECT。
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            when {
                text.startsWith(ENGINE_OPEN) -> webSocket.send("$SIO_CONNECTED${JSONObject().put("token", token.token)}")
                text == ENGINE_PING || text.startsWith("$ENGINE_PING$ENGINE_PROBE") ->
                    webSocket.send(ENGINE_PONG + text.removePrefix(ENGINE_PING))
                text.startsWith(SIO_CONNECTED) -> {
                    _status.value = RealtimeStatus.Connected
                    emitEvent("conversation:join", conversationId, ack = { ok -> joined.complete(ok) })
                }
                text.startsWith(SIO_ACK) -> handleAck(text)
                text.startsWith(SIO_EVENT) -> handleEvent(text, conversationId)
                text.startsWith(SIO_DISCONNECT) || text.startsWith(SIO_CONNECT_ERROR) -> {
                    if (!joined.isCompleted) joined.complete(false)
                    webSocket.close(NORMAL_CLOSURE, null)
                }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!joined.isCompleted) joined.complete(false)
            _status.value = RealtimeStatus.Failed(t.message ?: "实时通道连接失败")
            closed.complete(Unit)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!joined.isCompleted) joined.complete(false)
            closed.complete(Unit)
        }
    }

    /** 发一条带 ack 的 Socket.IO 事件；[ack] 为 null 时不等回执。 */
    private fun emitEvent(event: String, conversationId: String, ack: ((Boolean) -> Unit)?) {
        val ws = socket ?: return
        val payload = JSONArray().put(event).put(conversationId).toString()
        if (ack == null) {
            ws.send("$SIO_EVENT$payload")
            return
        }
        val ackId = ackIds.getAndIncrement()
        joinAcks[ackId] = ack
        ws.send("$SIO_EVENT$ackId$payload")
    }

    private fun handleAck(text: String) {
        val body = text.removePrefix(SIO_ACK)
        val digits = body.takeWhile { it.isDigit() }
        if (digits.isEmpty()) return
        val ackId = digits.toIntOrNull() ?: return
        val callback = joinAcks.remove(ackId) ?: return
        val payload = body.removePrefix(digits)
        val ok = runCatching { JSONArray(payload).optJSONObject(0)?.optBoolean("ok") ?: false }
            .getOrDefault(false)
        callback(ok)
    }

    private fun handleEvent(text: String, conversationId: String) {
        val payload = runCatching { JSONArray(text.removePrefix(SIO_EVENT)) }.getOrNull() ?: return
        if (payload.optString(0) != "chat:event") return
        val event = payload.optJSONObject(1) ?: return
        val eventConversationId = event.optString("conversationId")
        if (eventConversationId != conversationId) return
        _events.tryEmit(
            ChatRealtimeEvent(
                type = event.optString("type"),
                conversationId = eventConversationId,
                messageId = event.optString("messageId").takeIf { it.isNotBlank() && it != "null" },
            ),
        )
    }

    private fun backoffMillis(attempt: Int): Long =
        (BASE_BACKOFF_MILLIS shl (attempt - 1).coerceIn(0, 4)).coerceAtMost(MAX_BACKOFF_MILLIS)

    companion object {
        private const val WS_PATH = "/socket.io/?EIO=4&transport=websocket"
        private const val NORMAL_CLOSURE = 1000
        /** 提前这么多秒换新令牌重连，避开服务端按 exp 的强制断连。 */
        private const val REFRESH_LEAD_SECONDS = 60
        private const val MAX_ATTEMPTS = 5
        private const val BASE_BACKOFF_MILLIS = 2_000L
        private const val MAX_BACKOFF_MILLIS = 30_000L

        private const val ENGINE_OPEN = "0"
        private const val ENGINE_PING = "2"
        private const val ENGINE_PROBE = "probe"
        private const val ENGINE_PONG = "3"
        /** Socket.IO CONNECT / 命名空间连接成功都是 `40` 前缀（错误是 `44`）。 */
        private const val SIO_CONNECTED = "40"
        private const val SIO_DISCONNECT = "41"
        private const val SIO_EVENT = "42"
        private const val SIO_ACK = "43"
        private const val SIO_CONNECT_ERROR = "44"

        /** 心跳交给 Engine.IO 协议层（ping/pong 文本帧），这里关掉 OkHttp 自己的 ping。 */
        private fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .pingInterval(0, TimeUnit.SECONDS)
            .build()
    }
}
