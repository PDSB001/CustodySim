package com.custodysim.app.location

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.custodysim.app.CustodySimApp
import com.custodysim.app.MainActivity
import com.custodysim.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Visible, opt-in short cadence. GPS is requested only when due, with no wake lock. */
class LocationIntervalService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var loop: Job? = null
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as CustodySimApp).container
        val interval = LocationPreferences.intervalMinutes(this)
        if (!shouldRun(this) || !container.locationCollector.hasForegroundPermission()) {
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,
            getString(R.string.location_short_channel), NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        val open = PendingIntent.getActivity(this, ID,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_location_notification)
            .setContentTitle(getString(R.string.location_short_channel))
            .setContentText(getString(R.string.location_short_running, interval))
            .setContentIntent(open).setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
        try {
            ServiceCompat.startForeground(this, ID, notification,
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
        } catch (_: SecurityException) {
            container.locationReporting.record("定位服务启动受限，请检查定位权限后重新打开应用")
            stopSelf()
            return START_NOT_STICKY
        } catch (_: IllegalStateException) {
            container.locationReporting.record("系统暂不允许启动定位服务，已保留后台周期检查")
            stopSelf()
            return START_NOT_STICKY
        }
        activeInterval = interval
        if (loop?.isActive != true) loop = scope.launch {
            while (isActive && shouldRun(this@LocationIntervalService) && container.hasSession() &&
                container.locationCollector.hasForegroundPermission()) {
                container.locationReporting.collectIfDue(foreground = true)
                delay(30_000)
            }
            stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        activeInterval = null
        scope.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "location_short_interval"
        private const val ID = 2102
        @Volatile private var activeInterval: Long? = null

        private fun shouldRun(context: Context): Boolean =
            LocationPreferences.isEnabled(context) && LocationPreferences.intervalMinutes(context) < 15 &&
                (context.applicationContext as CustodySimApp).container.locationReporting.isEligible()

        /** Call only while the user is in the app, never from boot or a scheduled worker. */
        fun sync(context: Context) {
            val intent = Intent(context, LocationIntervalService::class.java)
            val container = (context.applicationContext as CustodySimApp).container
            if (!shouldRun(context) || !container.locationCollector.hasForegroundPermission()) {
                context.stopService(intent)
                return
            }
            if (activeInterval == LocationPreferences.intervalMinutes(context)) return
            try { ContextCompat.startForegroundService(context, intent) }
            catch (_: SecurityException) { container.locationReporting.record("定位服务启动受限，请检查权限") }
            catch (_: IllegalStateException) { container.locationReporting.record("请回到应用以启动短周期定位服务") }
        }
    }
}
