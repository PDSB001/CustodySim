package com.custodysim.app.data.net

import com.custodysim.app.config.AppConfig
import com.custodysim.app.data.auth.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 唯一的 HTTP 出口，负责三件事：
 *
 * 1. 每个请求都带上原生客户端头（缺了会被服务端同源校验 403）；
 * 2. 自动附加 `Authorization: Bearer`；
 * 3. 收到 401 时**单飞**刷新令牌并重试一次，刷新失败才判定会话丢失。
 *
 * 令牌只在内存里缓存一份供拦截器同步读取，持久化由 [TokenStore] 负责。
 */
class ApiClient(
    private val tokenStore: TokenStore,
    private val baseUrl: String,
    private val onSessionLost: () -> Unit = {},
) {

    @Volatile private var closed = false

    fun close() {
        closed = true
        accessToken = null
        client.dispatcher.cancelAll()
        bareClient.dispatcher.cancelAll()
        client.connectionPool.evictAll()
    }

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    /** 刷新互斥：并发刷新会有一路拿 401（旧令牌已被轮换作废），必须串行化。 */
    private val refreshMutex = Mutex()

    @Volatile
    private var accessToken: String? = null

    /** 裸客户端只用于刷新：不带鉴权拦截器，避免"刷新 401 → 又触发刷新"的递归。 */
    private val bareClient = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor { chain ->
            if (closed) throw java.io.IOException("服务器连接已关闭")
            chain.proceed(chain.request())
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val client = bareClient.newBuilder()
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val builder = chain.request().newBuilder()
                .header(AppConfig.NATIVE_CLIENT_HEADER, AppConfig.NATIVE_CLIENT_VALUE)
            if (chain.request().url.encodedPath !in setOf(AppConfig.PATH_LOGIN, AppConfig.PATH_MFA_VERIFY)) {
                accessToken?.let { builder.header("Authorization", "Bearer $it") }
            }
            chain.proceed(builder.build())
        }
        .authenticator { _, response -> retryWithFreshToken(response) }
        .build()

    /** 进程启动时用本地凭证回填内存缓存。 */
    fun setAccessToken(token: String?) {
        if (!closed) accessToken = token
    }

    /** Workers can start a process without AuthRepository.restoreSession / an Activity. */
    suspend fun restoreAccessTokenIfNeeded() = refreshMutex.withLock {
        if (!closed && accessToken == null) accessToken = tokenStore.accessToken()
    }

    suspend fun get(path: String): ApiResult<JSONObject> = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(baseUrl + path).get().build())
    }

    /** 供 data 为数组的列表接口使用。 */
    suspend fun getArray(path: String): ApiResult<JSONArray> = withContext(Dispatchers.IO) {
        executeList(Request.Builder().url(baseUrl + path).get().build())
    }

    suspend fun post(path: String, body: JSONObject? = null): ApiResult<JSONObject> =
        withContext(Dispatchers.IO) {
            execute(
                Request.Builder()
                    .url(baseUrl + path)
                    .post((body?.toString() ?: "{}").toRequestBody(jsonMediaType))
                    .build(),
            )
        }

    suspend fun patch(path: String, body: JSONObject? = null): ApiResult<JSONObject> =
        withContext(Dispatchers.IO) {
            execute(
                Request.Builder()
                    .url(baseUrl + path)
                    .patch((body?.toString() ?: "{}").toRequestBody(jsonMediaType))
                    .build(),
            )
        }

    /** 登录用：服务端要求可信设备值走请求头（浏览器才用 cookie）。 */
    suspend fun postWithTrustedDevice(
        path: String,
        body: JSONObject,
        trustedDevice: String?,
    ): ApiResult<JSONObject> = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url(baseUrl + path)
            .post(body.toString().toRequestBody(jsonMediaType))
        if (!trustedDevice.isNullOrBlank()) {
            builder.header(AppConfig.TRUSTED_DEVICE_HEADER, trustedDevice)
        }
        execute(builder.build())
    }

    private fun execute(request: Request): ApiResult<JSONObject> = try {
        client.newCall(request).execute().use { response ->
            val result = parseEnvelope(response.body?.string().orEmpty(), response.code)
            if (result is ApiResult.Err && response.code == 429) {
                result.copy(retryAfterSeconds = retryAfterSeconds(response.header("Retry-After"), result.message))
            } else result
        }
    } catch (error: Exception) {
        // 网络层失败：凭证保持不动，让用户重试；不要当成会话失效。
        ApiResult.Err(ApiErrorCode.UNKNOWN, error.message ?: "网络连接失败", 0)
    }

    private fun executeList(request: Request): ApiResult<JSONArray> = try {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            try {
                val root = JSONObject(body)
                if (root.optBoolean("success", false)) {
                    val data = root.opt("data")
                    ApiResult.Ok(if (data is JSONArray) data else JSONArray())
                } else {
                    val error = root.optJSONObject("error")
                    ApiResult.Err(
                        code = ApiErrorCode.from(error?.optString("code")),
                        message = error?.optString("message")?.takeIf(String::isNotBlank) ?: "请求失败",
                        httpStatus = response.code,
                    )
                }
            } catch (_: Exception) {
                ApiResult.Err(ApiErrorCode.UNKNOWN, "服务端返回了无法解析的内容", response.code)
            }
        }
    } catch (error: Exception) {
        ApiResult.Err(ApiErrorCode.UNKNOWN, error.message ?: "网络连接失败", 0)
    }

    private fun retryWithFreshToken(response: Response): Request? {
        val request = response.request
        // 本来就没带令牌的请求（登录、刷新本身）不该走这条路
        val failedHeader = request.header("Authorization") ?: return null
        if (responseCount(response) >= 2) return null
        val fresh = runBlocking { refresh(failedHeader) } ?: return null
        return request.newBuilder().header("Authorization", "Bearer $fresh").build()
    }

    /**
     * 用刷新令牌换新的访问令牌。
     *
     * @param failedAuthHeader 触发本次刷新的那个 Authorization 值，用于判断别的线程是否已经刷过。
     * @return 可用的访问令牌；返回 null 表示本次未能恢复（调用方的请求会以原样失败）。
     */
    private suspend fun refresh(failedAuthHeader: String): String? = refreshMutex.withLock {
        if (closed) return@withLock null
        val current = accessToken
        if (current != null && "Bearer $current" != failedAuthHeader) {
            // 已有别的线程刷新成功，直接用新令牌重试，避免重复消费轮换令牌
            return@withLock current
        }
        val refreshToken = withContext(Dispatchers.IO) { tokenStore.refreshToken() }
            ?: return@withLock null

        val request = Request.Builder()
            .url(baseUrl + AppConfig.PATH_REFRESH)
            .post(
                JSONObject().put("refreshToken", refreshToken).toString()
                    .toRequestBody(jsonMediaType),
            )
            .header(AppConfig.NATIVE_CLIENT_HEADER, AppConfig.NATIVE_CLIENT_VALUE)
            .build()

        val result = try {
            bareClient.newCall(request).execute().use { response ->
                parseEnvelope(response.body?.string().orEmpty(), response.code)
            }
        } catch (_: Exception) {
            return@withLock null
        }

        if (closed) return@withLock null
        when (result) {
            is ApiResult.Ok -> {
                val newAccess = result.data.optString("token")
                val newRefresh = result.data.optString("refreshToken")
                if (newAccess.isBlank() || newRefresh.isBlank()) {
                    loseSession()
                    null
                } else {
                    withContext(Dispatchers.IO) { tokenStore.saveTokens(newAccess, newRefresh) }
                    accessToken = newAccess
                    newAccess
                }
            }

            is ApiResult.Err -> {
                // 只有 401 才算会话失效；403（缺客户端头）与 5xx 都不该清凭证
                if (result.isUnauthorized) loseSession()
                null
            }
        }
    }

    private suspend fun loseSession() {
        accessToken = null
        withContext(Dispatchers.IO) { tokenStore.clear() }
        onSessionLost()
    }

    /** 数一数这个请求被重试过几次（含首次），用于避免无限刷新。 */
    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}
