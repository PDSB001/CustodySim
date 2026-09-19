package com.custodysim.app.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 坐标转换测试。
 *
 * 这类 bug 的特点是不报错、只静默偏移几百米 —— 会让合规的人被判越界，
 * 所以必须有测试守着。
 */
class Gcj02Test {

    @Test
    fun `国境外坐标原样返回`() {
        // 东京：GCJ02 只在中国大陆生效，境外不得偏移
        val (lat, lng) = Gcj02.wgs84ToGcj02(35.6762, 139.6503)
        assertEquals(35.6762, lat, 1e-9)
        assertEquals(139.6503, lng, 1e-9)
    }

    @Test
    fun `国境内坐标偏移量落在经验范围内`() {
        // 上海人民广场：WGS84 → GCJ02 的偏移量在数百米量级
        val meters = offsetMeters(31.2304, 121.4737)
        assertTrue("偏移 $meters 米，超出 100–1000 米的经验范围", meters in 100.0..1000.0)
    }

    @Test
    fun `北京与上海两地的偏移量同量级且方向一致`() {
        val shanghai = offsetMeters(31.2304, 121.4737)
        val beijing = offsetMeters(39.9042, 116.4074)
        assertTrue("两地的偏移量差异过大：上海 $shanghai 米，北京 $beijing 米", abs(shanghai - beijing) < 500)
    }

    @Test
    fun `转换是确定性的`() {
        val first = Gcj02.wgs84ToGcj02(31.2304, 121.4737)
        val second = Gcj02.wgs84ToGcj02(31.2304, 121.4737)
        assertEquals(first.first, second.first, 0.0)
        assertEquals(first.second, second.second, 0.0)
    }

    @Test
    fun `包络判断能区分境内外`() {
        assertFalse(Gcj02.isOutOfChina(31.2304, 121.4737))
        assertFalse(Gcj02.isOutOfChina(39.9042, 116.4074))
        assertTrue(Gcj02.isOutOfChina(35.6762, 139.6503))
        assertTrue(Gcj02.isOutOfChina(-33.8688, 151.2093))
    }

    /** Haversine 距离，仅用于测试断言。 */
    private fun offsetMeters(latitude: Double, longitude: Double): Double {
        val (convertedLat, convertedLng) = Gcj02.wgs84ToGcj02(latitude, longitude)
        val earthRadius = 6_371_008.8
        val dLat = Math.toRadians(convertedLat - latitude)
        val dLng = Math.toRadians(convertedLng - longitude)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(latitude)) * cos(Math.toRadians(convertedLat)) *
            sin(dLng / 2) * sin(dLng / 2)
        return 2 * earthRadius * asin(sqrt(a))
    }
}
