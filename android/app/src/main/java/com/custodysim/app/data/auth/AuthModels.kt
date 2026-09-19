package com.custodysim.app.data.auth

import org.json.JSONObject

/** 会话用户，字段与服务端 `SessionUserSchema` 一一对应。 */
data class SessionUser(
    val id: String,
    val username: String,
    val name: String,
    val role: String,
    val organizationId: String?,
    val mustChangePassword: Boolean,
) {
    val isSupervised: Boolean get() = role == "SUPERVISED"

    companion object {
        fun from(json: JSONObject) = SessionUser(
            id = json.optString("id"),
            username = json.optString("username"),
            name = json.optString("name"),
            role = json.optString("role"),
            organizationId = json.optString("organizationId").takeIf { it.isNotBlank() && it != "null" },
            mustChangePassword = json.optBoolean("mustChangePassword", false),
        )
    }
}

/**
 * 登录结果。
 *
 * 服务端在启用 MFA 时不会直接发令牌，而是返回 `{requiresMfa:true, mfaToken}`，
 * 客户端需用挑战令牌继续调用 MFA 验证接口。
 */
sealed interface LoginOutcome {
    data class Session(val user: SessionUser) : LoginOutcome
    data class MfaRequired(val mfaToken: String) : LoginOutcome
}
