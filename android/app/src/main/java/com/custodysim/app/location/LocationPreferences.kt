package com.custodysim.app.location

import androidx.core.content.edit
import android.content.Context

/** Short intervals use a visible location service; periodic work remains a fallback. */
object LocationPreferences {
    const val MIN_INTERVAL_MINUTES = 5L
    const val MAX_INTERVAL_MINUTES = 360L
    const val DEFAULT_INTERVAL_MINUTES = 15L
    val intervals = listOf(5L, 10L) + (15L..360L step 15L)

    private const val FILE = "location_preferences"
    private const val ENABLED = "enabled"
    private const val INTERVAL = "interval_minutes"

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit { putBoolean(ENABLED, enabled) }
    }

    fun intervalMinutes(context: Context): Long = prefs(context)
        .getLong(INTERVAL, DEFAULT_INTERVAL_MINUTES)
        .coerceIn(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)

    fun setIntervalMinutes(context: Context, minutes: Long) {
        prefs(context).edit { putLong(INTERVAL, minutes.coerceIn(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)) }
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
