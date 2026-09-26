package com.custodysim.app.ui.chat

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val chatTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.getDefault())
    .withZone(ZoneId.systemDefault())

/** The API sends UTC instants (ISO-8601 with Z); render them in the device's local time zone. */
internal fun formatChatTime(value: String): String = runCatching {
    chatTimeFormatter.format(Instant.parse(value))
}.getOrElse {
    value.replace('T', ' ').take(16)
}
