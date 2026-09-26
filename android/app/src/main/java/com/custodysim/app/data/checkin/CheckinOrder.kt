package com.custodysim.app.data.checkin

import java.time.OffsetDateTime

internal fun CheckinSlot.startsAt(): Long = runCatching {
    OffsetDateTime.parse(scheduleAt).toInstant().toEpochMilli()
}.getOrDefault(Long.MAX_VALUE)

internal fun CheckinSlot.endsAt(): Long = runCatching {
    OffsetDateTime.parse(deadline).toInstant().toEpochMilli()
}.getOrDefault(Long.MIN_VALUE)

/** Active slots precede upcoming slots; never promote an expired or completed task. */
internal fun firstCheckin(slots: List<CheckinSlot>, now: Long): CheckinSlot? = slots
    .filter { it.status == "PENDING" && it.startsAt() <= it.endsAt() && it.endsAt() >= now }
    .sortedWith(compareBy<CheckinSlot> { if (it.startsAt() <= now) 0 else 1 }
        .thenBy { it.startsAt() }.thenBy { it.taskId })
    .firstOrNull()

internal fun CheckinSlot.displayStatus(now: Long): String =
    if (status == "PENDING" && endsAt() < now) "MISSED" else status
