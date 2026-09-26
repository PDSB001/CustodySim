package com.custodysim.app.data.checkin

import com.custodysim.app.data.location.PendingPoint
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONObject

/** 点名与补卡接口。 */
class CheckinRepository(private val apiClient: ApiClient) {

    suspend fun fetchToday(): ApiResult<List<CheckinSlot>> =
        when (val result = apiClient.getArray("/api/checkins")) {
            is ApiResult.Ok -> {
                val slots = mutableListOf<CheckinSlot>()
                for (i in 0 until result.data.length()) {
                    slots.add(CheckinSlot.from(result.data.getJSONObject(i)))
                }
                ApiResult.Ok(slots)
            }
            is ApiResult.Err -> result
        }

    /**
     * 打卡。调用方按用户选择传入 GPS 坐标；无坐标时明确使用 IP 定位。
     */
    suspend fun checkin(
        taskId: String,
        remark: String?,
        photo: String?,
        point: PendingPoint?,
    ): ApiResult<JSONObject> {
        val body = JSONObject().put("taskId", taskId).put("locationSource", if (point == null) "IP" else "GPS")
        if (!remark.isNullOrBlank()) body.put("remark", remark)
        if (!photo.isNullOrBlank()) body.put("photo", photo)
        if (point != null) {
            body.put("locationSource", "GPS")
            body.put(
                "location",
                JSONObject()
                    .put("lat", point.latitude)
                    .put("lng", point.longitude)
                    .put("accuracy", point.accuracyMeters),
            )
        }
        return apiClient.post("/api/checkins", body)
    }

    suspend fun createMakeup(
        taskId: String,
        reason: String,
        photo: String?,
        point: PendingPoint?,
    ): ApiResult<JSONObject> {
        val body = JSONObject().put("taskId", taskId).put("reason", reason).put("locationSource", if (point == null) "IP" else "GPS")
        if (!photo.isNullOrBlank()) body.put("photo", photo)
        if (point != null) {
            body.put("locationSource", "GPS")
            body.put(
                "location",
                JSONObject()
                    .put("lat", point.latitude)
                    .put("lng", point.longitude)
                    .put("accuracy", point.accuracyMeters),
            )
        }
        return apiClient.post("/api/makeups", body)
    }
}
