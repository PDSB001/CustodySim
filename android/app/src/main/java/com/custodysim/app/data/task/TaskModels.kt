package com.custodysim.app.data.task

import org.json.JSONObject

/** 任务模板里的一个字段。 */
data class TaskField(
    val name: String,
    val type: String,
    val required: Boolean,
    val options: List<String>,
) {
    companion object {
        fun from(json: JSONObject): TaskField {
            val options = json.optJSONArray("options")
            val list = mutableListOf<String>()
            for (i in 0 until (options?.length() ?: 0)) {
                list.add(options!!.optString(i))
            }
            return TaskField(
                name = json.optString("name"),
                type = json.optString("type"),
                required = json.optBoolean("required", false),
                options = list,
            )
        }
    }
}

/** 一条汇报任务（含模板字段与最新提交状态）。 */
data class ReportTask(
    val id: String,
    val title: String,
    val scheduleAt: String,
    val deadline: String,
    val status: String,
    val fields: List<TaskField>,
    val submissionId: String?,
    val submissionStatus: String?,
    val reviewComment: String?,
    val reviewGrade: Double?,
    val templateContent: String?,
    val submissionData: JSONObject?,
) {
    companion object {
        fun from(json: JSONObject): ReportTask {
            val template = json.optJSONObject("templateSnapshot")
            val fieldsArray = template?.optJSONArray("fields")
            val fields = mutableListOf<TaskField>()
            for (i in 0 until (fieldsArray?.length() ?: 0)) {
                fields.add(TaskField.from(fieldsArray!!.getJSONObject(i)))
            }
            val grade = json.opt("reviewGrade")
            return ReportTask(
                id = json.optString("id"),
                title = json.optString("title"),
                scheduleAt = json.optString("scheduleAt"),
                deadline = json.optString("deadline"),
                status = json.optString("status"),
                fields = fields,
                submissionId = json.optString("submissionId").takeIf { it.isNotBlank() && it != "null" },
                submissionStatus = json.optString("submissionStatus").takeIf { it.isNotBlank() && it != "null" },
                reviewComment = json.optString("reviewComment").takeIf { it.isNotBlank() && it != "null" },
                reviewGrade = if (grade is Number) grade.toDouble() else null,
                templateContent = template?.optString("content")?.takeIf { it.isNotBlank() && it != "null" },
                submissionData = json.optJSONObject("data"),
            )
        }
    }
}
