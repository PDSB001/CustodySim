package com.custodysim.app.location

import androidx.core.content.edit
import android.content.Context
import com.custodysim.app.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Foreground and scheduled work share a durable cadence; no timers run in the background. */
class LocationReporting(private val context: Context, private val container: AppContainer) {
    private val prefs = context.getSharedPreferences("location_reporting${container.endpoint.namespace}", Context.MODE_PRIVATE)
    private val mutex = Mutex()
    private var startupAttempted = false
    private val _status = MutableStateFlow(prefs.getString("status", "尚未自动采集")!!)
    val status = _status.asStateFlow()

    fun setEligible(eligible: Boolean) {
        prefs.edit { putBoolean("eligible", eligible) }
    }

    fun isEligible(): Boolean = container.active && prefs.getBoolean("eligible", false)

    fun record(message: String) {
        prefs.edit { putString("status", message) }
        _status.value = message
    }

    suspend fun collectIfDue(foreground: Boolean, startup: Boolean = false) = mutex.withLock {
        if (!isEligible() || !LocationPreferences.isEnabled(context) || !container.hasSession()) return@withLock
        if (!container.locationCollector.hasForegroundPermission() ||
            (!foreground && !container.locationCollector.hasBackgroundPermission())) {
            record("定位权限不足，等待授权")
            return@withLock
        }
        val now = System.currentTimeMillis()
        val interval = LocationPreferences.intervalMinutes(context) * 60_000
        val startupCapture = startup && !startupAttempted
        if (LocationTiming.shouldCapture(startupCapture, now, prefs.getLong("last_attempt", 0), interval)) {
            prefs.edit { putLong("last_attempt", now) }
            try {
                record("正在采集位置…")
                val point = container.locationCollector.collectOnce(allowCached = !startupCapture)
                if (!isEligible() || !LocationPreferences.isEnabled(context) || !container.hasSession()) return@withLock
                if (point == null) {
                    record("未获得新鲜位置，下个周期重试")
                } else {
                    container.pendingPointStore.append(listOf(point))
                    record("已采集，等待联网上传")
                }
                if (startupCapture) startupAttempted = true
            } catch (cancelled: CancellationException) {
                // A foreground-to-background transition may cancel an in-flight fix.
                prefs.edit { remove("last_attempt") }
                throw cancelled
            } catch (_: Exception) {
                if (startupCapture) startupAttempted = true
                record("定位采集或保存失败，下个周期重试")
            }
        }
        if (container.pendingPointStore.size() > 0) LocationScheduler.uploadPending(context)
    }
}
