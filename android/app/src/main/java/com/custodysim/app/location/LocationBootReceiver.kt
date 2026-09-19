package com.custodysim.app.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 重启或升级后恢复 WorkManager 周期任务；真正的执行仍受系统节电策略管理。 */
class LocationBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            LocationScheduler.ensurePeriodic(context)
        }
    }
}
