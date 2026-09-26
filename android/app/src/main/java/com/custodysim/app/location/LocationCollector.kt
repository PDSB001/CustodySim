package com.custodysim.app.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.CancellationSignal
import android.os.Build
import android.os.SystemClock
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
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
 * 太旧或没有才等一次实时定位（总计 15 秒超时），网络定位失败后尝试 GPS。
 * 不回退到过期缓存，避免把旧位置误报为本次采集。
 */
class LocationCollector(private val context: Context) {
    private val captureMutex = Mutex()

    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    fun hasForegroundPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun hasBackgroundPermission(): Boolean =
        if (Build.VERSION.SDK_INT < 29) hasForegroundPermission() else
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** @return 转换后的待上报点；无权限且无任何可用位置时返回 null。 */
    @SuppressLint("MissingPermission")
    suspend fun collectOnce(allowCached: Boolean = true): PendingPoint? = captureMutex.withLock {
        if (!hasForegroundPermission()) return@withLock null

        val known = if (allowCached) lastKnown() else null
        val fix = withTimeoutOrNull(FIX_TIMEOUT_MS) {
            known?.takeIf { isFresh(it) } ?: providers().firstNotNullOfOrNull { provider ->
                withTimeoutOrNull(if (provider == LocationManager.NETWORK_PROVIDER) 5_000L else 10_000L) {
                    requestSingleFix(provider)?.takeIf { isFresh(it) }
                }
            }
        } ?: return@withLock null

        // Android 给的是 WGS84；服务端与腾讯底图都按 GCJ02，必须转换
        val (latitude, longitude) = Gcj02.wgs84ToGcj02(fix.latitude, fix.longitude)
        PendingPoint.of(
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
        .mapNotNull {
            try { locationManager.getLastKnownLocation(it) }
            catch (_: SecurityException) { null }
            catch (_: IllegalArgumentException) { null }
        }
        .maxByOrNull { it.time }

    private fun isFresh(location: Location): Boolean =
        LocationTiming.isFresh(SystemClock.elapsedRealtimeNanos() / 1_000_000,
            location.elapsedRealtimeNanos / 1_000_000, System.currentTimeMillis(), location.time) &&
            location.latitude.isFinite() && location.latitude in -90.0..90.0 &&
            location.longitude.isFinite() && location.longitude in -180.0..180.0 &&
            (!location.hasAccuracy() || (location.accuracy.isFinite() && location.accuracy >= 0))

    @SuppressLint("MissingPermission")
    private suspend fun requestSingleFix(provider: String): Location? {
        return suspendCancellableCoroutine { continuation ->
            val signal = CancellationSignal()
            continuation.invokeOnCancellation { signal.cancel() }
            runCatching {
                LocationManagerCompat.getCurrentLocation(
                    locationManager,
                    provider,
                    signal,
                    ContextCompat.getMainExecutor(context),
                ) { location ->
                    if (continuation.isActive) continuation.resume(location)
                }
            }.onFailure {
                if (continuation.isActive) continuation.resume(null)
            }
        }
    }

    private companion object {
        /** 等一次实时定位的超时。 */
        const val FIX_TIMEOUT_MS = 15_000L
    }
}
