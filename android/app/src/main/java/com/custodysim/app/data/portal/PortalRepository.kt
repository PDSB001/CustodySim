package com.custodysim.app.data.portal

import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject

data class PortalNotice(val id: String, val title: String, val content: String, val read: Boolean)
data class PortalApplication(val title: String, val status: String, val reason: String, val submittedAt: String?)
data class PortalArchive(val code: String, val formName: String, val lockedAt: String?, val data: JSONObject?)
data class ProfileField(
    val name: String,
    val type: String,
    val required: Boolean,
    val options: List<String>,
)
data class ProfileForm(val id: String, val name: String, val content: String?, val fields: List<ProfileField>)
data class ProfileRecord(
    val id: String,
    val userName: String,
    val formId: String,
    val formName: String,
    val data: JSONObject,
    val photoData: String?,
    val signatureData: String?,
    val officialSealData: String?,
    val status: String,
    val code: String?,
    val boxName: String?,
    val submittedAt: String?,
    val lockedAt: String?,
    val updatedAt: String,
    val fields: List<ProfileField>,
)

class PortalRepository(private val api: ApiClient) {
    private fun parseFields(array: JSONArray?): List<ProfileField> = (0 until (array?.length() ?: 0)).map { index ->
        val item = array!!.getJSONObject(index)
        val options = item.optJSONArray("options")?.let { values ->
            (0 until values.length()).map { values.optString(it) }
        } ?: emptyList()
        ProfileField(item.optString("name"), item.optString("type"), item.optBoolean("required"), options)
    }

    suspend fun profileForms(): ApiResult<List<ProfileForm>> = when (val result = api.getArray("/api/profile-forms")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            ProfileForm(item.optString("id"), item.optString("name"), item.optString("content").takeIf { it.isNotBlank() && it != "null" }, parseFields(item.optJSONArray("fields")))
        })
    }

    suspend fun profileRecords(): ApiResult<List<ProfileRecord>> = when (val result = api.getArray("/api/profile-records")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            ProfileRecord(
                id = item.optString("id"), userName = item.optString("userName"), formId = item.optString("formId"),
                formName = item.optString("formName"), data = item.optJSONObject("data") ?: JSONObject(),
                photoData = item.optString("photoData").takeIf { it.startsWith("data:image/") },
                signatureData = item.optString("signatureData").takeIf { it.startsWith("data:image/") },
                officialSealData = item.optString("officialSealData").takeIf { it.startsWith("data:image/") },
                status = item.optString("status"), code = item.optString("code").takeIf { it.isNotBlank() && it != "null" },
                boxName = item.optString("boxName").takeIf { it.isNotBlank() && it != "null" },
                submittedAt = item.optString("submittedAt").takeIf { it.isNotBlank() && it != "null" },
                lockedAt = item.optString("lockedAt").takeIf { it.isNotBlank() && it != "null" },
                updatedAt = item.optString("updatedAt"), fields = parseFields(item.optJSONArray("fields")),
            )
        })
    }

    /**
     * 保存档案草稿。
     *
     * [photoData] 始终随请求发送：传 null 表示清除已上传的证件照（服务端 schema 允许 nullable）。
     */
    suspend fun saveProfileRecord(formId: String, data: JSONObject, photoData: String? = null): ApiResult<JSONObject> {
        val body = JSONObject()
            .put("formId", formId)
            .put("data", data)
            .put("signatureMode", "GENERATED")
            .put("photoData", photoData ?: JSONObject.NULL)
        return api.post("/api/profile-records", body)
    }

    suspend fun submitProfileRecord(recordId: String): ApiResult<JSONObject> =
        api.post("/api/profile-records/submit", JSONObject().put("recordId", recordId))
    suspend fun submitApplication(type: String, reason: String, startAt: String? = null, endAt: String? = null): ApiResult<JSONObject> {
        val body = JSONObject().put("type", type).put("reason", reason)
        when (type) {
            "LEAVE" -> body.put("leaveStartAt", startAt).put("leaveEndAt", endAt)
            "TEMPORARY_OUT_OF_CUSTODY" -> body.put("temporaryReleaseStartAt", startAt).put("temporaryReleaseEndAt", endAt)
        }
        return api.post("/api/applications", body)
    }

    suspend fun notices(): ApiResult<List<PortalNotice>> = when (val result = api.get("/api/notices?limit=50")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> {
            val items = result.data.optJSONArray("items") ?: JSONArray()
            ApiResult.Ok((0 until items.length()).map { i ->
                val item = items.getJSONObject(i)
                PortalNotice(item.optString("id"), item.optString("title"), item.optString("content"), !item.isNull("readAt"))
            })
        }
    }

    suspend fun markNoticeRead(noticeId: String): ApiResult<JSONObject> =
        api.patch("/api/notices", JSONObject().put("noticeId", noticeId))

    suspend fun applications(): ApiResult<List<PortalApplication>> = when (val result = api.getArray("/api/applications")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).map { i ->
            val item = result.data.getJSONObject(i)
            PortalApplication(item.optString("title"), item.optString("status"), item.optString("reason"), item.optString("submittedAt").takeIf { it.isNotBlank() && it != "null" })
        })
    }

    suspend fun archives(): ApiResult<List<PortalArchive>> = when (val result = api.getArray("/api/profile-records")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> ApiResult.Ok((0 until result.data.length()).mapNotNull { i ->
            val item = result.data.getJSONObject(i)
            val lockedAt = item.optString("lockedAt").takeIf { it.isNotBlank() && it != "null" }
            lockedAt?.let { PortalArchive(item.optString("code"), item.optString("formName"), it, item.optJSONObject("data")) }
        })
    }
}
