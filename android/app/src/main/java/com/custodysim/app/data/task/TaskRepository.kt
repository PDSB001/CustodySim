package com.custodysim.app.data.task

import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject

/** 汇报任务接口。 */
class TaskRepository(private val apiClient: ApiClient) {

    suspend fun fetchTasks(): ApiResult<List<ReportTask>> =
        when (val result = apiClient.getArray("/api/tasks")) {
            is ApiResult.Ok -> {
                val tasks = mutableListOf<ReportTask>()
                for (i in 0 until result.data.length()) {
                    tasks.add(ReportTask.from(result.data.getJSONObject(i)))
                }
                ApiResult.Ok(tasks)
            }
            is ApiResult.Err -> result
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
