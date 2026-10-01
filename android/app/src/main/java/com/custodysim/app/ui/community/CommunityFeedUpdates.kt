package com.custodysim.app.ui.community

import com.custodysim.app.data.community.CommunityPost

/** Latest locally confirmed change for a post, ordered against in-flight feed reads. */
internal data class CommunityFeedMutation(val revision: Int, val post: CommunityPost?)

/** Reapply changes committed after a feed request began without reordering remote posts. */
internal fun mergeCommunityFeedUpdates(
    posts: List<CommunityPost>,
    changes: Map<String, CommunityFeedMutation>,
    afterRevision: Int,
): List<CommunityPost> {
    val merged = posts.distinctBy { it.id }.toMutableList()
    // Apply oldest first so newly published posts are prepended in publication order.
    changes.entries.asSequence()
        .filter { it.value.revision > afterRevision }
        .sortedBy { it.value.revision }
        .forEach { (id, change) ->
            val index = merged.indexOfFirst { it.id == id }
            val post = change.post
            when {
                post == null -> merged.removeAll { it.id == id }
                index >= 0 -> merged[index] = post
                else -> merged.add(0, post)
            }
        }
    return merged.distinctBy { it.id }
}
