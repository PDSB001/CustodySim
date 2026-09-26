package com.custodysim.app.location

internal object LocationTiming {
    fun shouldCapture(startupPending: Boolean, now: Long, last: Long, interval: Long): Boolean =
        startupPending || isDue(now, last, interval)

    fun isDue(now: Long, last: Long, interval: Long): Boolean =
        last <= 0 || now < last || now - last >= interval

    fun isFresh(elapsedNow: Long, elapsedFix: Long, wallNow: Long, wallFix: Long): Boolean =
        elapsedFix > 0 && elapsedNow - elapsedFix in 0..300_000L &&
            wallNow - wallFix in 0..300_000L
}
