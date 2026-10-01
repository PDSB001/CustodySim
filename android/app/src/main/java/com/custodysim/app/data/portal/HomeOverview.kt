package com.custodysim.app.data.portal

import org.json.JSONObject

data class HomeCheckins(val total: Int, val completed: Int, val pending: Int, val missed: Int)
data class HomeTasks(val pending: Int, val review: Int)
data class HomeApplications(val review: Int, val returned: Int)
data class HomeProfiles(val draft: Int, val returned: Int, val review: Int, val locked: Int)

/** Only counts belonging to the authenticated user; no profile bodies or image payloads. */
data class HomeOverview(
    val checkins: HomeCheckins?,
    val tasks: HomeTasks?,
    val applications: HomeApplications?,
    val profiles: HomeProfiles?,
    val unreadNotices: Int,
) {
    companion object {
        fun from(json: JSONObject) = HomeOverview(
            checkins = json.optJSONObject("checkins")?.let {
                HomeCheckins(it.optInt("total"), it.optInt("completed"), it.optInt("pending"), it.optInt("missed"))
            },
            tasks = json.optJSONObject("tasks")?.let { HomeTasks(it.optInt("pending"), it.optInt("review")) },
            applications = json.optJSONObject("applications")?.let { HomeApplications(it.optInt("review"), it.optInt("returned")) },
            profiles = json.optJSONObject("profiles")?.let {
                HomeProfiles(it.optInt("draft"), it.optInt("returned"), it.optInt("review"), it.optInt("locked"))
            },
            unreadNotices = json.optInt("unreadNotices"),
        )
    }
}
