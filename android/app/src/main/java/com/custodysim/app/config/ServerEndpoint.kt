package com.custodysim.app.config

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.UUID

/** Immutable origin and storage boundary. An empty namespace preserves the installed app's data. */
data class ServerEndpoint(val baseUrl: String, val realtimeUrl: String, val namespace: String) {
    companion object {
        fun normalize(input: String): String {
            val raw = input.trim()
            require(raw.startsWith("https://", ignoreCase = true) && '\\' !in raw) { "请输入 https:// 开头的服务器地址" }
            val url = raw.toHttpUrlOrNull() ?: error("服务器地址格式不正确")
            require(url.username.isEmpty() && url.password.isEmpty() && '@' !in raw.substringAfter("://").substringBefore('/')) {
                "地址不能包含账号或密码"
            }
            require(url.encodedPath == "/" && url.query == null && url.fragment == null) { "请填写服务器根地址，不要包含路径、查询参数或锚点" }
            val host = url.host
            require(host.contains('.') && !host.endsWith(".local") && !host.endsWith(".localhost") &&
                !host.contains(':') && !host.all { it.isDigit() || it == '.' }) { "请使用公网 HTTPS 域名；内网联调继续使用构建配置" }
            return url.toString().removeSuffix("/")
        }

        fun selected(input: String): ServerEndpoint {
            val origin = normalize(input)
            return ServerEndpoint(origin, origin.replaceFirst("https://", "wss://"), UUID.randomUUID().toString())
        }
    }
}
