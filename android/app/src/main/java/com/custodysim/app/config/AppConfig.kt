package com.custodysim.app.config

import com.custodysim.app.BuildConfig

/** 客户端与服务端的约定常量。改这里等于改协议，务必同步 docs/android-client.md。 */
object AppConfig {

    /** 服务端根地址，来自 gradle.properties 的 `custodysim.baseUrl`（未尾斜杠）。 */
    val baseUrl: String = BuildConfig.BASE_URL.trimEnd('/')

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
    const val PATH_CHANGE_PASSWORD = "/api/auth/change-password"
    const val PATH_ME = "/api/me"
    const val PATH_LOCATION_CONFIG = "/api/mobile/location/config"
    const val PATH_LOCATION_BATCH = "/api/mobile/location/batch"
}
