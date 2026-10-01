package com.custodysim.app.config

import android.content.Context
import com.custodysim.app.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

class ServerSettings(context: Context) {
    private val prefs = context.getSharedPreferences("server_selection", Context.MODE_PRIVATE)
    fun read(): ServerEndpoint {
        val origin = prefs.getString("origin", null)
        val namespace = prefs.getString("namespace", null)
        return if (origin != null && namespace != null) {
            val normalized = ServerEndpoint.normalize(origin)
            ServerEndpoint(normalized, normalized.replaceFirst("https://", "wss://"), namespace)
        } else {
            // Bind legacy credentials to the original compiled endpoint once, even across APK updates.
            val initial = prefs.getString("initial_origin", null)
            if (initial == null) check(prefs.edit().putString("initial_origin", AppConfig.baseUrl)
                .putString("initial_realtime", AppConfig.realtimeUrl).commit()) { "无法保存初始服务器配置" }
            // LAN development builds follow DHCP changes in the compiled defaults.
            // Explicit server selections and public origins retain their storage boundary.
            if (BuildConfig.NEEDS_LOCAL_NETWORK && isPrivateHttp(initial) && isPrivateHttp(AppConfig.baseUrl)) {
                return ServerEndpoint(AppConfig.baseUrl, AppConfig.realtimeUrl, "")
            }
            ServerEndpoint(initial ?: AppConfig.baseUrl,
                prefs.getString("initial_realtime", AppConfig.realtimeUrl)!!, "")
        }
    }

    fun save(endpoint: ServerEndpoint) {
        check(prefs.edit().putString("origin", endpoint.baseUrl)
            .putString("namespace", endpoint.namespace).commit()) { "无法保存服务器配置，请重试" }
    }

    private fun isPrivateHttp(origin: String?): Boolean {
        val url = origin?.toHttpUrlOrNull() ?: return false
        if (url.scheme != "http") return false
        val parts = url.host.split('.').mapNotNull { it.toIntOrNull() }
        return parts.size == 4 && (parts[0] == 10 ||
            (parts[0] == 172 && parts[1] in 16..31) ||
            (parts[0] == 192 && parts[1] == 168))
    }
}
