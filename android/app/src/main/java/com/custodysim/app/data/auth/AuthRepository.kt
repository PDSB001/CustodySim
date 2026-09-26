package com.custodysim.app.data.auth

import android.util.Log
import com.custodysim.app.config.AppConfig
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiErrorCode
import com.custodysim.app.data.net.ApiResult
import org.json.JSONObject

/**
 * 鉴权流程。令牌的持久化与内存缓存都在这里收口，其余层只认 [SessionUser]。
 *
 * 几条容易写错的服务端语义（详见 docs/android-client.md）：
 * - `trustDevice` 缺省为 **true**，共用终端必须显式传 false；
 * - 改密成功后响应体不含新令牌，且 tokenVersion 已递增 → 必须重新登录；
 * - 登出保留可信设备授权（服务端有意为之），改密则撤销。
 */
class AuthRepository(
    private val apiClient: ApiClient,
    private val tokenStore: TokenStore,
) {

    private companion object {
        const val TAG = "CustodySim.Auth"
    }

    /** 启动时回填内存缓存并校验会话；返回 null 表示需要登录。 */
    suspend fun restoreSession(): SessionUser? {
        val access = tokenStore.accessToken()
        if (access == null) {
            Log.d(TAG, "restoreSession: accessToken null")
            return null
        }
        Log.d(TAG, "restoreSession: accessToken present, calling /me")
        apiClient.setAccessToken(access)
        return when (val result = apiClient.get(AppConfig.PATH_ME)) {
            is ApiResult.Ok -> {
                Log.d(TAG, "restoreSession: /me OK")
                SessionUser.from(result.data)
            }
            is ApiResult.Err -> {
                Log.d(TAG, "restoreSession: /me ERR ${result.code}/${result.httpStatus} ${result.message}")
                null
            }
        }
    }

    suspend fun login(username: String, password: String): ApiResult<LoginOutcome> {
        val body = JSONObject()
            .put("username", username.trim())
            .put("password", password)
        return when (
            val result = apiClient.postWithTrustedDevice(
                path = AppConfig.PATH_LOGIN,
                body = body,
                trustedDevice = tokenStore.trustedDevice(),
            )
        ) {
            is ApiResult.Ok -> {
                if (result.data.optBoolean("requiresMfa", false)) {
                    val mfaToken = result.data.optString("mfaToken")
                    if (mfaToken.isBlank()) {
                        ApiResult.Err(
                            ApiErrorCode.UNKNOWN,
                            "服务端要求二次验证但未下发挑战令牌",
                            200,
                        )
                    } else {
                        ApiResult.Ok(LoginOutcome.MfaRequired(mfaToken))
                    }
                } else {
                    saveSessionTokens(result.data)
                    ApiResult.Ok(LoginOutcome.Session(SessionUser.from(result.data)))
                }
            }

            is ApiResult.Err -> result
        }
    }

    /**
     * MFA 二次验证。
     *
     * @param trustDevice 30 天内免二次验证。共用终端传 false。
     */
    suspend fun verifyMfa(
        code: String,
        trustDevice: Boolean,
        mfaToken: String,
    ): ApiResult<SessionUser> {
        val body = JSONObject()
            .put("code", code.trim())
            .put("trustDevice", trustDevice)
            .put("mfaToken", mfaToken)
        return when (val result = apiClient.post(AppConfig.PATH_MFA_VERIFY, body)) {
            is ApiResult.Ok -> {
                saveSessionTokens(result.data)
                result.data.optString("trustedDevice")
                    .takeIf { it.isNotBlank() }
                    ?.let { tokenStore.saveTrustedDevice(it) }
                ApiResult.Ok(SessionUser.from(result.data))
            }

            is ApiResult.Err -> result
        }
    }

    /** 登出：服务端 tokenVersion+1，等于退出全部设备；可信设备按设计保留。 */
    suspend fun logout(): ApiResult<Unit> {
        val result = apiClient.post(AppConfig.PATH_LOGOUT)
        clearLocalTokens(keepTrustedDevice = true)
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Err -> result
        }
    }

    private suspend fun saveSessionTokens(data: JSONObject) {
        val access = data.optString("token")
        val refresh = data.optString("refreshToken")
        if (access.isBlank() || refresh.isBlank()) return
        tokenStore.saveTokens(access, refresh)
        apiClient.setAccessToken(access)
    }

    private suspend fun clearLocalTokens(keepTrustedDevice: Boolean) {
        apiClient.setAccessToken(null)
        val trusted = if (keepTrustedDevice) tokenStore.trustedDevice() else null
        tokenStore.clear()
        if (keepTrustedDevice && !trusted.isNullOrBlank()) {
            tokenStore.saveTrustedDevice(trusted)
        }
    }
}
