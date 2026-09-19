package com.custodysim.app.location

import android.content.Context

/** 本地位置上报开关与周期。周期受 WorkManager 的 15 分钟下限约束。 */
object LocationPreferences {
    const val MIN_INTERVAL_MINUTES = 15L
    const val MAX_INTERVAL_MINUTES = 360L
    const val STEP_MINUTES = 15L

    private const val FILE = "location_preferences"
    private const val ENABLED = "enabled"
    private const val INTERVAL = "interval_minutes"

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(ENABLED, enabled).apply()
    }

    fun intervalMinutes(context: Context): Long = prefs(context)
        .getLong(INTERVAL, MIN_INTERVAL_MINUTES)
        .coerceIn(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)

    fun setIntervalMinutes(context: Context, minutes: Long) {
        prefs(context).edit().putLong(INTERVAL, minutes.coerceIn(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)).apply()
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
