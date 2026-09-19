package com.custodysim.app.data.task

import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** 汇报任务接口。 */
class TaskRepository(private val apiClient: ApiClient) {

    /**
     * 拉取任务列表。
     *
     * 传 [limit] / [cursor] 时按 (scheduleAt, id) 倒序游标分页，避免一次把全部任务拉回来；
     * 都不传则与旧行为一致（一次取全部）。游标格式为 `scheduleAt|id`，取上一页最后一条。
     */
    suspend fun fetchTasks(limit: Int? = null, cursor: String? = null): ApiResult<List<ReportTask>> {
        val query = buildList {
            limit?.let { add("limit=$it") }
            cursor?.takeIf { it.isNotBlank() }?.let { add("cursor=" + URLEncoder.encode(it, "UTF-8")) }
        }
        val path = if (query.isEmpty()) "/api/tasks" else "/api/tasks?" + query.joinToString("&")
        return when (val result = apiClient.getArray(path)) {
            is ApiResult.Ok -> {
                val tasks = mutableListOf<ReportTask>()
                for (i in 0 until result.data.length()) {
                    tasks.add(ReportTask.from(result.data.getJSONObject(i)))
                }
                ApiResult.Ok(tasks)
            }
            is ApiResult.Err -> result
        }
    }

    /** 提交汇报。data 的键为字段名，值按其类型：IMAGE 为字符串数组，其余为字符串。 */
    suspend fun submit(taskId: String, data: Map<String, Any?>): ApiResult<JSONObject> {
        val payload = JSONObject()
        data.forEach { (key, value) ->
            when (value) {
                is List<*> -> {
                    val array = JSONArray()
                    value.forEach { array.put(it) }
                    payload.put(key, array)
                }
                else -> payload.put(key, value)
            }
        }
        val body = JSONObject().put("taskId", taskId).put("data", payload)
        return apiClient.post("/api/submissions", body)
    }
}
