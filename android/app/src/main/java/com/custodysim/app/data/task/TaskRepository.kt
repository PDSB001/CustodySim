package com.custodysim.app.data.task

import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * 任务分类，与 Web 端「服刑任务」的筛选保持一致：
 * [PENDING] 待执行（PENDING/RETURNED）、[REVIEW] 待批阅（SUBMITTED）、[HISTORY] 执行记录（其余状态）。
 */
enum class TaskCategory(val value: String) {
    PENDING("pending"), REVIEW("review"), HISTORY("history")
}

/** 三个分类各自的条数，用于分类按钮上的数字。 */
data class TaskCounts(val pending: Int, val review: Int, val history: Int) {
    fun of(category: TaskCategory): Int = when (category) {
        TaskCategory.PENDING -> pending
        TaskCategory.REVIEW -> review
        TaskCategory.HISTORY -> history
    }
}

/** 汇报任务接口。 */
class TaskRepository(private val apiClient: ApiClient) {

    /**
     * 拉取任务列表。
     *
     * 传 [category] 时按分类筛选并分页：待执行按截止时间正序、其余倒序，
     * 游标格式为 `deadline|id`（取上一页最后一条）；不传则与旧行为一致（一次取全部）。
     */
    suspend fun fetchTasks(
        limit: Int? = null,
        cursor: String? = null,
        category: TaskCategory? = null,
    ): ApiResult<List<ReportTask>> {
        val query = buildList {
            limit?.let { add("limit=$it") }
            category?.let { add("category=" + it.value) }
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

    /** 三个分类的条数。 */
    suspend fun fetchTaskCounts(): ApiResult<TaskCounts> =
        when (val result = apiClient.get("/api/tasks?counts=1")) {
            is ApiResult.Ok -> ApiResult.Ok(
                TaskCounts(
                    pending = result.data.optInt("pending"),
                    review = result.data.optInt("review"),
                    history = result.data.optInt("history"),
                ),
            )
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
