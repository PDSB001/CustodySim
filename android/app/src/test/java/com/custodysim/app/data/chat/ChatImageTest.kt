package com.custodysim.app.data.chat

import com.custodysim.app.data.media.resolveImageUrl
import org.junit.Assert.*
import org.junit.Test

class ChatImageTest {
    private val path = "/api/chat/messages/message-id/image"
    private val data = "data:image/png;base64,AAAA"

    private fun message(vararg fields: Pair<String, Any?>): ChatMessage {
        val values = mapOf("id" to "message-id", "type" to "IMAGE") + fields.toMap()
        return parseMessage(
            string = { values[it] as? String },
            boolean = { values[it] as? Boolean },
            integer = { values[it] as? Int ?: 0 },
        )
    }

    @Test fun `runtime server joins with either trailing slash`() {
        for (base in listOf("https://one.example", "https://one.example/")) {
            assertEquals("https://one.example$path", resolveImageUrl(base, path))
        }
        assertEquals("http://two.example:3000$path", resolveImageUrl("http://two.example:3000/", path))
        assertNull(resolveImageUrl("https://one.example", "https://other.example$path"))
        assertNull(resolveImageUrl("https://one.example", "//other.example$path"))
        assertEquals("https://one.example$path", resolveImageUrl("https://one.example", "https://one.example$path"))
    }

    @Test fun `generation two maps endpoint and availability without altering path`() {
        val item = message("imageUrl" to path, "hasImage" to true, "content" to null, "readCount" to 2)
        assertEquals(path, item.imageUrl)
        assertTrue(item.hasImage)
        assertTrue(item.isImage)
        assertNull(item.content)
        assertEquals(2, item.readCount)
        assertEquals("https://one.example$path", item.imageSource { resolveImageUrl("https://one.example", it) })
        assertEquals("https://two.example$path", item.imageSource { resolveImageUrl("https://two.example", it) })
    }

    @Test fun `endpoint wins over legacy content`() {
        val item = message("imageUrl" to path, "hasImage" to true, "content" to data)
        assertEquals("https://one.example$path", item.imageSource { resolveImageUrl("https://one.example", it) })
    }

    @Test fun `old server and optimistic messages fall back to local data URL`() {
        val item = message("imageUrl" to null, "content" to data)
        assertTrue(item.hasImage)
        assertEquals(data, item.imageSource { error("Local data must not resolve remotely") })
        assertEquals(data, item.copy(imageUrl = "").imageSource { error("Unexpected resolve") })
        assertNull(message("content" to "not an image").imageSource { it })
    }

    @Test fun `explicit false and recall suppress all image loading`() {
        val unavailable = message("imageUrl" to path, "hasImage" to false, "content" to data)
        assertFalse(unavailable.hasImage)
        assertTrue(unavailable.isImage)
        assertNull(unavailable.imageSource { error("Must not load") })
        val recalled = message("imageUrl" to path, "hasImage" to true, "recalledAt" to "2026-09-27T00:00:00Z")
        assertNull(recalled.imageSource { error("Must not load") })
        val text = message("type" to "TEXT", "content" to "hello", "hasImage" to false)
        assertFalse(text.isImage)
        assertNull(text.imageUrl)
    }
}
