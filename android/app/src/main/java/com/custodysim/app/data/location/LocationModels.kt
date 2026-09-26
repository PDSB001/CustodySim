package com.custodysim.app.data.location

import org.json.JSONObject
import java.time.Instant

/**
 * 待上报的定位点。
 *
 * [capturedAt] 用 ISO-8601（UTC，带 Z）——服务端 schema 是 `datetime({offset:true})`，
 * 接受 `Z` 与 `±HH:MM` 两种写法。
 */
data class PendingPoint(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double,
    val capturedAt: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("latitude", latitude)
        .put("longitude", longitude)
        .put("accuracyMeters", accuracyMeters)
        .put("capturedAt", capturedAt)

    companion object {
        fun of(
            latitude: Double,
            longitude: Double,
            accuracyMeters: Double,
            capturedAtMillis: Long,
        ) = PendingPoint(
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = accuracyMeters,
            capturedAt = Instant.ofEpochMilli(capturedAtMillis).toString(),
        )

        fun from(json: JSONObject) = PendingPoint(
            latitude = json.getDouble("latitude"),
            longitude = json.getDouble("longitude"),
            accuracyMeters = json.optDouble("accuracyMeters", 0.0),
            capturedAt = json.getString("capturedAt"),
        )
    }
}

/** 服务端下发的上报策略。客户端不得硬编码这些数字。 */
data class LocationPolicy(
    val minIntervalSeconds: Int,
    val maxIntervalSeconds: Int,
    val maxPointsPerBatch: Int,
    val maxPointsPerDay: Int,
    val maxReportAgeSeconds: Int,
    val maxFutureSkewSeconds: Int,
    val retentionHours: Int,
) {
    companion object {
        /** 拉不到策略时的保守默认值，仅用于让上报逻辑不至于空转。 */
        val FALLBACK = LocationPolicy(
            minIntervalSeconds = 60,
            maxIntervalSeconds = 3600,
            maxPointsPerBatch = 180,
            maxPointsPerDay = 1584,
            maxReportAgeSeconds = 21600,
            maxFutureSkewSeconds = 300,
            retentionHours = 72,
        )

        fun from(json: JSONObject) = LocationPolicy(
            minIntervalSeconds = json.optInt("minIntervalSeconds", 60),
            maxIntervalSeconds = json.optInt("maxIntervalSeconds", 3600),
            maxPointsPerBatch = json.optInt("maxPointsPerBatch", 180),
            maxPointsPerDay = json.optInt("maxPointsPerDay", 1584),
            maxReportAgeSeconds = json.optInt("maxReportAgeSeconds", 21600),
            maxFutureSkewSeconds = json.optInt("maxFutureSkewSeconds", 300),
            retentionHours = json.optInt("retentionHours", 72),
        )
    }
}

/** 批量上报结果，`skipped` 是服务端判定"不新于已有记录"而跳过的点数。 */
data class BatchReportResult(
    val accepted: Int,
    val skipped: Int,
    val crossings: Int,
) {
    companion object {
        fun from(json: JSONObject) = BatchReportResult(
            accepted = json.optInt("accepted", 0),
            skipped = json.optInt("skipped", 0),
            crossings = json.optInt("crossings", 0),
        )
    }
}
