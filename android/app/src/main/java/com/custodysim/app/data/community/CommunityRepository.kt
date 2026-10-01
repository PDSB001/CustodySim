package com.custodysim.app.data.community

import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.net.ApiResult
import org.json.JSONArray
import org.json.JSONObject

data class CommunityField(val name: String, val value: String)
data class CommunityPost(val id: String, val title: String, val content: String, val authorLabel: String,
    val isOwn: Boolean, val canDelete: Boolean, val createdAt: String, val commentCount: Int,
    val imageUrls: List<String>, val profileSnapshot: List<CommunityField>)
data class CommunityComment(val id: String, val content: String, val authorLabel: String,
    val isOwn: Boolean, val canDelete: Boolean, val createdAt: String)
data class CommunityFeed(val posts: List<CommunityPost>, val hasMore: Boolean)
data class CommunityDetail(val post: CommunityPost, val comments: List<CommunityComment>, val hasMore: Boolean)

// Keep scalar field types aligned with lib/community-contract.ts.
val communityProfileFieldTypes = setOf(
    "TEXT", "TEXTAREA", "NUMBER", "SELECT", "DATE", "COPYWRITE",
)

class CommunityRepository(private val api: ApiClient) {
    private fun post(item: JSONObject): CommunityPost {
        val images = item.optJSONArray("imageUrls") ?: JSONArray()
        val fields = item.optJSONArray("profileSnapshot") ?: JSONArray()
        return CommunityPost(item.getString("id"), item.getString("title"), item.getString("content"),
            item.getString("authorLabel"), item.optBoolean("isOwn"), item.optBoolean("canDelete"),
            item.getString("createdAt"), item.optInt("commentCount"),
            (0 until images.length()).map { images.getString(it) },
            (0 until fields.length()).map { fields.getJSONObject(it).let { f -> CommunityField(f.getString("name"), f.getString("value")) } })
    }
    suspend fun feed(page: Int): ApiResult<CommunityFeed> = when (val result = api.get("/api/community/posts?page=$page")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> {
            val items = result.data.getJSONArray("posts")
            ApiResult.Ok(CommunityFeed((0 until items.length()).map { post(items.getJSONObject(it)) }, result.data.optBoolean("hasMore")))
        }
    }
    suspend fun detail(id: String, page: Int): ApiResult<CommunityDetail> = when (val result = api.get("/api/community/posts/$id?page=$page")) {
        is ApiResult.Err -> result
        is ApiResult.Ok -> {
            val comments = result.data.getJSONArray("comments")
            ApiResult.Ok(CommunityDetail(post(result.data.getJSONObject("post")), (0 until comments.length()).map {
                val item = comments.getJSONObject(it)
                CommunityComment(item.getString("id"), item.getString("content"), item.getString("authorLabel"),
                    item.optBoolean("isOwn"), item.optBoolean("canDelete"), item.getString("createdAt"))
            }, result.data.optBoolean("hasMore")))
        }
    }
    suspend fun publish(title: String, content: String, images: List<String>, onProgress: (Int) -> Unit): ApiResult<JSONObject> =
        api.post("/api/community/posts", JSONObject().put("title", title).put("content", content).put("images", JSONArray(images)), onProgress)
    suspend fun comment(id: String, content: String): ApiResult<JSONObject> =
        api.post("/api/community/posts/$id/comments", JSONObject().put("content", content))
    suspend fun remove(type: String, id: String): ApiResult<JSONObject> = api.delete("/api/community/$type/$id")
}
