package com.custodysim.app.location

/**
 * WGS84 → GCJ02（俗称火星坐标系）转换。
 *
 * 为什么必须做这一步：服务端的 `coordinateSystem` 只接受 `GCJ02`，腾讯底图也是 GCJ02；
 * 而 Android 的 LocationManager / FusedLocationProvider 返回的是 **WGS84**。
 * 两者在国内相差 300–600 米，直接上报会把守规矩的人判成越界、也会让轨迹整体偏移。
 *
 * 只有在中国大陆范围内才需要偏移：国境外 GCJ02 等同于 WGS84，算法里直接跳过。
 * 不要拿这段代码去发 BD09（百度）——那还要再做一次 GCJ02 → BD09。
 */
object Gcj02 {

    /** 克拉索夫斯基椭球长半轴（米）。 */
    private const val EARTH_AXIS = 6378245.0

    /** 第一偏心率的平方。 */
    private const val ECCENTRICITY_SQUARED = 0.00669342162296594323

    /**
     * 粗略判断是否在中国大陆之外。
     *
     * 用的是行业通行的矩形包络（含港澳台与南海区域的近似边界），
     * 只用于决定"要不要做偏移"，精度足够——真正的合规判定在服务端。
     */
    fun isOutOfChina(latitude: Double, longitude: Double): Boolean =
        longitude < 72.004 || longitude > 137.8347 ||
            latitude < 0.8293 || latitude > 55.8271

    /**
     * 把 WGS84 坐标转为 GCJ02。
     *
     * @return 转换后的 `纬度 to 经度`；国境外原样返回。
     */
    fun wgs84ToGcj02(latitude: Double, longitude: Double): Pair<Double, Double> {
        if (isOutOfChina(latitude, longitude)) return latitude to longitude

        var deltaLat = transformLatitude(longitude - 105.0, latitude - 35.0)
        var deltaLng = transformLongitude(longitude - 105.0, latitude - 35.0)

        val radLat = latitude / 180.0 * PI
        var magic = kotlin.math.sin(radLat)
        magic = 1 - ECCENTRICITY_SQUARED * magic * magic
        val sqrtMagic = kotlin.math.sqrt(magic)

        deltaLat = (deltaLat * 180.0) /
            ((EARTH_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic) * PI)
        deltaLng = (deltaLng * 180.0) /
            (EARTH_AXIS / sqrtMagic * kotlin.math.cos(radLat) * PI)

        return (latitude + deltaLat) to (longitude + deltaLng)
    }

    private const val PI = kotlin.math.PI

    private fun transformLatitude(x: Double, y: Double): Double {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * kotlin.math.sqrt(kotlin.math.abs(x))
        ret += (20.0 * kotlin.math.sin(6.0 * x * PI) + 20.0 * kotlin.math.sin(2.0 * x * PI)) * 2.0 / 3.0
        ret += (20.0 * kotlin.math.sin(y * PI) + 40.0 * kotlin.math.sin(y / 3.0 * PI)) * 2.0 / 3.0
        ret += (160.0 * kotlin.math.sin(y / 12.0 * PI) + 320.0 * kotlin.math.sin(y * PI / 30.0)) * 2.0 / 3.0
        return ret
    }

    private fun transformLongitude(x: Double, y: Double): Double {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * kotlin.math.sqrt(kotlin.math.abs(x))
        ret += (20.0 * kotlin.math.sin(6.0 * x * PI) + 20.0 * kotlin.math.sin(2.0 * x * PI)) * 2.0 / 3.0
        ret += (20.0 * kotlin.math.sin(x * PI) + 40.0 * kotlin.math.sin(x / 3.0 * PI)) * 2.0 / 3.0
        ret += (150.0 * kotlin.math.sin(x / 12.0 * PI) + 300.0 * kotlin.math.sin(x / 30.0 * PI)) * 2.0 / 3.0
        return ret
    }
}
