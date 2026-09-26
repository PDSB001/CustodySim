package com.custodysim.app.config

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Separate anonymous client: never reuse authentication, cookies, or redirects. */
object ServerProbe {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .callTimeout(15, TimeUnit.SECONDS).build()

    suspend fun check(origin: String): String = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(Request.Builder().url("$origin/api/mobile/server-info").get().build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(IOException("连接失败，请检查地址、网络和 HTTPS 证书", e))
            }
            override fun onResponse(call: Call, response: Response) {
                val result = runCatching {
                    response.use {
                        check(it.isSuccessful) { "检测失败（HTTP ${it.code}），请确认服务端已升级并使用最终 HTTPS 地址" }
                        val source = it.body?.source() ?: error("服务端返回空内容")
                        check(!source.request(16_385)) { "检测响应过大，无法识别该服务器" }
                        val root = JSONObject(source.readUtf8())
                        val data = root.optJSONObject("data") ?: error("不是兼容的 CustodySim 服务")
                        val protocol = data.optJSONObject("nativeProtocol")
                        check(root.optBoolean("success") && data.optString("product") == "CustodySim" &&
                            protocol != null && protocol.optInt("min", Int.MAX_VALUE) <= 1 &&
                            protocol.optInt("max", 0) >= 1 && data.optString("realtimePath") == "/socket.io/") {
                            "服务端协议不兼容，请联系维护人员升级"
                        }
                        data.optString("version").take(64)
                    }
                }
                if (continuation.isActive) result.fold(continuation::resume, continuation::resumeWithException)
            }
        })
    }
}
