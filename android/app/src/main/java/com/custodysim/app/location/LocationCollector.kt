package com.custodysim.app.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import com.custodysim.app.data.location.PendingPoint
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * 采集一个定位点并转换成服务端要求的 GCJ02。
 *
 * 刻意不用 Google Play Services 的 FusedLocationProvider：目标设备多为国产 ROM，
 * GMS 缺失或受限时整个采集会**静默失败**（正是"配置能拉到、坐标永远不上报"的形态），
 * 而 Android 框架自带的 [LocationManager] 在所有设备上都可用。
 *
 * 策略：先取 5 分钟内的最近已知位置（Wi-Fi/基站定位的缓存通常就有），
 * 太旧或没有才等一次实时定位（15 秒超时），再不行退回缓存位置。
 */
class LocationCollector(private val context: Context) {

    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    fun hasForegroundPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun hasBackgroundPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** @return 转换后的待上报点；无权限且无任何可用位置时返回 null。 */
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    suspend fun collectOnce(): PendingPoint? {
        if (!hasForegroundPermission()) return null

        val known = lastKnown()
        val fix = withTimeoutOrNull(FIX_TIMEOUT_MS) {
            known?.takeIf { isFresh(it) } ?: requestSingleFix()
        } ?: known ?: return null

        // Android 给的是 WGS84；服务端与腾讯底图都按 GCJ02，必须转换
        val (latitude, longitude) = Gcj02.wgs84ToGcj02(fix.latitude, fix.longitude)
        return PendingPoint.of(
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = if (fix.hasAccuracy()) fix.accuracy.toDouble() else 0.0,
            capturedAtMillis = fix.time,
        )
    }

    /** 当前可用的定位源：优先网络定位（室内快），其次 GPS。 */
    private fun providers(): List<String> = listOf(
        LocationManager.NETWORK_PROVIDER,
        LocationManager.GPS_PROVIDER,
    ).filter {
        runCatching { locationManager.isProviderEnabled(it) }.getOrDefault(false)
    }

    private fun lastKnown(): Location? = providers()
        .mapNotNull { runCatching { locationManager.getLastKnownLocation(it) }.getOrNull() }
        .maxByOrNull { it.time }

    private fun isFresh(location: Location): Boolean =
        System.currentTimeMillis() - location.time < FRESH_WINDOW_MS

    @SuppressLint("MissingPermission")
    private suspend fun requestSingleFix(): Location? {
        val provider = providers().firstOrNull() ?: return null
        return withTimeoutOrNull(FIX_TIMEOUT_MS) {
            if (Build.VERSION.SDK_INT >= 30) {
                suspendCancellableCoroutine<Location?> { continuation ->
                    val signal = CancellationSignal()
                    continuation.invokeOnCancellation { signal.cancel() }
                    runCatching {
                        locationManager.getCurrentLocation(
                            provider,
                            signal,
                            ContextCompat.getMainExecutor(context),
                        ) { location -> continuation.resume(location) }
                    }.onFailure { continuation.resume(null) }
                }
            } else {
                suspendCancellableCoroutine<Location?> { continuation ->
                    val listener = LocationListener { location -> continuation.resume(location) }
                    continuation.invokeOnCancellation {
                        runCatching { locationManager.removeUpdates(listener) }
                    }
                    runCatching {
                        locationManager.requestSingleUpdate(provider, listener, context.mainLooper)
                    }.onFailure { continuation.resume(null) }
                }
            }
        }
    }

    private companion object {
        /** 定位新鲜度阈值：5 分钟内的缓存位置直接可用。 */
        const val FRESH_WINDOW_MS = 5 * 60 * 1000L

        /** 等一次实时定位的超时。 */
        const val FIX_TIMEOUT_MS = 15_000L
    }
}
