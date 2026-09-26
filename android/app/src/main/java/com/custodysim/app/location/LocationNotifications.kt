package com.custodysim.app.location

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.custodysim.app.MainActivity
import com.custodysim.app.R

/** A single silent status notification, independent of location scheduling. */
object LocationNotifications {
    const val CHANNEL = "location_upload"
    private const val ID = 2101

    fun enabled(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun show(context: Context, message: String, uploading: Boolean = false) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,
            context.getString(R.string.location_notification_channel), NotificationManager.IMPORTANCE_LOW).apply {
            setShowBadge(false)
        })
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (!enabled(context)) return
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_location_notification)
            .setContentTitle(context.getString(R.string.location_notification_channel))
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(PendingIntent.getActivity(context, ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .setOnlyAlertOnce(true).setSilent(true).setAutoCancel(!uploading)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setProgress(0, 0, uploading)
            // An interrupted process cannot leave a permanent "uploading" indicator.
            .setTimeoutAfter(if (uploading) 120_000L else 86_400_000L)
            .build()
        try { manager.notify(ID, notification) } catch (_: SecurityException) { /* Permission revoked concurrently. */ }
    }

    fun cancel(context: Context) = context.getSystemService(NotificationManager::class.java).cancel(ID)
}
