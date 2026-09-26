package com.custodysim.app.data.net

import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** Also understands the older server's message until Retry-After is deployed. */
fun retryAfterSeconds(header: String?, message: String, nowMillis: Long = System.currentTimeMillis()): Long {
    val seconds = header?.trim()?.toLongOrNull()
        ?: runCatching {
            val deadline = ZonedDateTime.parse(header, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
            ((deadline - nowMillis + 999) / 1000).coerceAtLeast(0)
        }.getOrNull()
        ?: Regex("(\\d+)\\s*秒后").find(message)?.groupValues?.get(1)?.toLongOrNull()
        ?: 60L
    return seconds.coerceIn(1, 86400)
}
