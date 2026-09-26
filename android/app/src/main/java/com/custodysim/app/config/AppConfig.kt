package com.custodysim.app.config

import com.custodysim.app.BuildConfig

/** 客户端与服务端的约定常量。改这里等于改协议，务必同步 docs/android-client.md。 */
object AppConfig {

    /** 服务端根地址，来自私有构建配置（公开包为空）（未尾斜杠）。 */
    val baseUrl: String = EndpointCodec.decode(BuildConfig.BASE_URL_ENCODED).trimEnd('/')

    /**
     * 实时通道（Socket.IO）地址，来自私有构建配置（公开包为空）（未尾斜杠）。
     *
     * 生产是 `wss://`（与 [baseUrl] 同域，通常经反向代理）；联调指向开发机的 `:3001`。
     * 拿不到它不致命：聊天会降级为轮询（见 ChatRealtimeClient）。
     */
    val realtimeUrl: String = EndpointCodec.decode(BuildConfig.REALTIME_URL_ENCODED).trimEnd('/')

    /**
     * 原生客户端标识头。
     *
     * **每个请求都要带**：服务端在生产环境要求写请求有可信来源，原生 HTTP 客户端不发
     * `Origin`，缺这个头会被一律 403。它不参与鉴权，伪造它拿不到权限。
     * 协议变更时递增结尾的数字（服务端校验 `^android-app/\d+$`）。
     */
    const val NATIVE_CLIENT_HEADER = "X-CustodySim-Client"
    const val NATIVE_CLIENT_VALUE = "android-app/1"

    /** 可信设备头：登录时携带可跳过 MFA，值为服务端下发的 `<deviceId>.<token>`。 */
    const val TRUSTED_DEVICE_HEADER = "X-CustodySim-Trusted-Device"

    // ---- 接口路径 ----
    const val PATH_LOGIN = "/api/auth/login"
    const val PATH_MFA_VERIFY = "/api/auth/mfa/verify"
    const val PATH_REFRESH = "/api/auth/refresh"
    const val PATH_LOGOUT = "/api/auth/logout"
    const val PATH_ME = "/api/me"
    const val PATH_LOCATION_CONFIG = "/api/mobile/location/config"
    const val PATH_LOCATION_BATCH = "/api/mobile/location/batch"

    // ---- 聊天（详见 docs/android-client.md 第 5、6 节）----
    const val PATH_CHAT_CONVERSATIONS = "/api/chat/conversations"
    const val PATH_CHAT_CANDIDATES = "/api/chat/candidates"
    const val PATH_CHAT_REQUESTS = "/api/chat/requests"
    const val PATH_CHAT_REALTIME_TOKEN = "/api/chat/realtime-token"

    fun pathChatMessages(conversationId: String) = "$PATH_CHAT_CONVERSATIONS/$conversationId/messages"
    fun pathChatRead(conversationId: String) = "$PATH_CHAT_CONVERSATIONS/$conversationId/read"
    fun pathChatRecall(messageId: String) = "/api/chat/messages/$messageId/recall"
    fun pathChatRequestReview(requestId: String) = "$PATH_CHAT_REQUESTS/$requestId"
}
