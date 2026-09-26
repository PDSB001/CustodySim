package com.custodysim.app.data.net

import org.json.JSONObject

/**
 * 服务端统一响应包的客户端映射。
 *
 * ```
 * 成功：{"success":true, "data":{...}}
 * 失败：{"success":false,"error":{"code":"UNAUTHORIZED","message":"..."}}
 * ```
 *
 * 失败码定义见服务端 `lib/api-response.ts`。
 */
sealed interface ApiResult<out T> {

    data class Ok<T>(val data: T) : ApiResult<T>

    data class Err(
        val code: ApiErrorCode,
        val message: String,
        val httpStatus: Int,
        val retryAfterSeconds: Long? = null,
    ) : ApiResult<Nothing>
}

enum class ApiErrorCode {
    UNAUTHORIZED,
    FORBIDDEN,
    NOT_FOUND,
    VALIDATION_ERROR,
    CONFLICT,
    RATE_LIMITED,
    INTERNAL_ERROR,

    /** 服务端返回了非预期内容（含解析失败）。 */
    UNKNOWN;

    companion object {
        fun from(raw: String?): ApiErrorCode =
            entries.firstOrNull { it.name.equals(raw, ignoreCase = true) } ?: UNKNOWN
    }
}

/**
 * 会话已失效：401。
 *
 * 只有这种情况才该清本地凭证；403 常是缺客户端头或权限不足，清凭证会把用户无故登出。
 */
val ApiResult.Err.isUnauthorized: Boolean
    get() = httpStatus == 401

/** 可退避重试：限流或服务端故障。 */
val ApiResult.Err.isRetryable: Boolean
    get() = httpStatus == 0 || code == ApiErrorCode.RATE_LIMITED || httpStatus >= 500

/**
 * 解析统一响应包。
 *
 * 非 JSON 响应（例如反向代理返回的 413/502 页面）也会走到这里，统一归为 [ApiErrorCode.UNKNOWN]，
 * 但保留 HTTP 状态码 —— 401 的判定不能依赖响应体。
 */
fun parseEnvelope(body: String, httpStatus: Int): ApiResult<JSONObject> = try {
    val root = JSONObject(body)
    if (root.optBoolean("success", false)) {
        ApiResult.Ok(root.optJSONObject("data") ?: JSONObject())
    } else {
        val error = root.optJSONObject("error")
        ApiResult.Err(
            code = ApiErrorCode.from(error?.optString("code")),
            message = error?.optString("message")?.takeIf(String::isNotBlank) ?: "请求失败",
            httpStatus = httpStatus,
        )
    }
} catch (_: Exception) {
    ApiResult.Err(ApiErrorCode.UNKNOWN, "服务端返回了无法解析的内容", httpStatus)
}
