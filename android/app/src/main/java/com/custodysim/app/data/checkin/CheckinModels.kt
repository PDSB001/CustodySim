package com.custodysim.app.data.checkin

import org.json.JSONObject

/** 当天某个点名时段（任务 + 可选打卡记录 + 可选补卡）。 */
data class CheckinSlot(
    val taskId: String,
    val ruleName: String,
    val slotLabel: String?,
    val scheduleAt: String,
    val deadline: String,
    val status: String,
    val needRemark: Boolean,
    val recordId: String?,
    val recordStatus: String?,
    val checkinAt: String?,
    val remark: String?,
    val recordPhotoUrl: String?,
    val makeupId: String?,
    val makeupStatus: String?,
    val makeupReason: String?,
) {
    companion object {
        fun from(json: JSONObject) = CheckinSlot(
            taskId = json.optString("id"),
            ruleName = json.optString("ruleName"),
            slotLabel = json.optString("slotLabel").takeIf { it.isNotBlank() && it != "null" },
            scheduleAt = json.optString("scheduleAt"),
            deadline = json.optString("deadline"),
            status = json.optString("status"),
            needRemark = json.optBoolean("needRemark", false),
            recordId = json.optString("recordId").takeIf { it.isNotBlank() && it != "null" },
            recordStatus = json.optString("recordStatus").takeIf { it.isNotBlank() && it != "null" },
            checkinAt = json.optString("checkinAt").takeIf { it.isNotBlank() && it != "null" },
            remark = json.optString("remark").takeIf { it.isNotBlank() && it != "null" },
            recordPhotoUrl = json.optString("recordPhotoUrl").takeIf { it.isNotBlank() && it != "null" },
            makeupId = json.optString("makeupId").takeIf { it.isNotBlank() && it != "null" },
            makeupStatus = json.optString("makeupStatus").takeIf { it.isNotBlank() && it != "null" },
            makeupReason = json.optString("makeupReason").takeIf { it.isNotBlank() && it != "null" },
        )
    }
}

/** 我的补卡申请记录。 */
data class MakeupItem(
    val id: String,
    val taskId: String,
    val ruleName: String,
    val reason: String,
    val status: String,
    val reviewComment: String?,
    val createdAt: String,
) {
    companion object {
        fun from(json: JSONObject) = MakeupItem(
            id = json.optString("id"),
            taskId = json.optString("taskId"),
            ruleName = json.optString("ruleName"),
            reason = json.optString("reason"),
            status = json.optString("status"),
            reviewComment = json.optString("reviewComment").takeIf { it.isNotBlank() && it != "null" },
            createdAt = json.optString("createdAt"),
        )
    }
}
