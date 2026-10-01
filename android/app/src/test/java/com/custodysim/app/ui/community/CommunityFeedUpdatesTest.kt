package com.custodysim.app.ui.community

import com.custodysim.app.data.community.CommunityPost
import org.junit.Assert.assertEquals
import org.junit.Test

class CommunityFeedUpdatesTest {
    @Test
    fun publicationDuringRefreshStaysAheadOfRemotePosts() {
        val remote = listOf(post("remote-first"), post("remote-second"))
        val created = post("new-local-post")

        val result = mergeCommunityFeedUpdates(
            remote, mapOf(created.id to CommunityFeedMutation(11, created)), afterRevision = 10,
        )

        assertEquals(listOf("new-local-post", "remote-first", "remote-second"), result.map { it.id })
        assertEquals(created, result.first())
    }

    @Test
    fun confirmedCommentCountReplacesStaleRemotePostInPlace() {
        val first = post("first")
        val stale = post("commented", comments = 3)
        val last = post("last")
        val updated = stale.copy(commentCount = 4)

        val result = mergeCommunityFeedUpdates(
            listOf(first, stale, last),
            mapOf(stale.id to CommunityFeedMutation(8, updated)), afterRevision = 7,
        )

        assertEquals(listOf(first, updated, last), result)
    }

    @Test
    fun deletionDuringRefreshDoesNotRestoreDeletedPost() {
        val kept = post("kept")
        val deleted = post("deleted")

        val result = mergeCommunityFeedUpdates(
            listOf(kept, deleted),
            mapOf(deleted.id to CommunityFeedMutation(5, null)), afterRevision = 4,
        )

        assertEquals(listOf(kept), result)
    }

    @Test
    fun oldMutationsDoNotResurrectMissingPostsOrOverrideNewRemoteState() {
        val remote = post("remote", comments = 9)
        val present = post("present")
        val changes = mapOf(
            "removed-remotely" to CommunityFeedMutation(1, post("removed-remotely")),
            remote.id to CommunityFeedMutation(2, remote.copy(commentCount = 2)),
            present.id to CommunityFeedMutation(3, null),
        )

        val result = mergeCommunityFeedUpdates(listOf(remote, present), changes, afterRevision = 3)

        assertEquals(listOf(remote, present), result)
    }

    @Test
    fun duplicateRemoteIdsKeepFirstRemoteOccurrenceAndOrder() {
        val first = post("first", comments = 4)
        val second = post("second")

        val result = mergeCommunityFeedUpdates(
            listOf(first, second, first.copy(commentCount = 1), second), emptyMap(), afterRevision = 0,
        )

        assertEquals(listOf(first, second), result)
    }

    @Test
    fun multipleLocalPublicationsUseRevisionOrderRatherThanMapOrder() {
        val newer = post("newer")
        val older = post("older")
        val remote = post("remote")

        val result = mergeCommunityFeedUpdates(
            listOf(remote),
            linkedMapOf(newer.id to CommunityFeedMutation(12, newer), older.id to CommunityFeedMutation(11, older)),
            afterRevision = 10,
        )

        assertEquals(listOf(newer, older, remote), result)
    }

    private fun post(id: String, comments: Int = 0) = CommunityPost(
        id = id, title = "Post $id", content = "Content $id", authorLabel = "楼主",
        isOwn = true, canDelete = true, createdAt = "2026-10-01T00:00:00Z", commentCount = comments,
        imageUrls = emptyList(), profileSnapshot = emptyList(),
    )
}
