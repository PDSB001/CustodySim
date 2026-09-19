package com.custodysim.app.data.location

import com.custodysim.app.config.AppConfig
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject

/** 位置上报接口。策略与批量上报都在这里，队列与调度在 location 包。 */
class LocationRepository(private val apiClient: ApiClient) {

    /** 拉取服务端策略；失败时返回 [LocationPolicy.FALLBACK]，不阻断上报。 */
    suspend fun fetchPolicy(): LocationPolicy =
        when (val result = apiClient.get(AppConfig.PATH_LOCATION_CONFIG)) {
            is ApiResult.Ok -> LocationPolicy.from(result.data)
            is ApiResult.Err -> LocationPolicy.FALLBACK
        }

    /**
     * 批量上报。调用方负责按 `maxPointsPerBatch` 分片。
     *
     * 注意：服务端对"不新于已有记录"的点会**跳过而不报错**（重试是安全常态），
     * 因此这里把 skipped 一并回传，而不是当成失败。
     */
    suspend fun reportBatch(points: List<PendingPoint>): ApiResult<BatchReportResult> {
        if (points.isEmpty()) {
            return ApiResult.Ok(BatchReportResult(accepted = 0, skipped = 0, crossings = 0))
        }
        val array = JSONArray()
        points.forEach { array.put(it.toJson()) }
        val body = JSONObject()
            .put("points", array)
            .put("coordinateSystem", "GCJ02")
        return when (val result = apiClient.post(AppConfig.PATH_LOCATION_BATCH, body)) {
            is ApiResult.Ok -> ApiResult.Ok(BatchReportResult.from(result.data))
            is ApiResult.Err -> result
        }
    }
}
