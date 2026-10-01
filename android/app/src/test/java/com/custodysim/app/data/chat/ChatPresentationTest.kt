package com.custodysim.app.data.chat

import org.junit.Assert.*
import org.junit.Test

class ChatPresentationTest {
    @Test fun `acknowledgement and later polls preserve bubble identity but keep server fields`() {
        val local = ChatMessage("local-1", "me", "Me", "IMAGE", "data:image/png;base64,AAAA",
            null, false, "2026-09-27T00:00:00Z", 0, pending = true)
        val server = local.copy(id = "server-1", presentationKey = "server-1", pending = false,
            content = null, imageUrl = "/api/chat/messages/server-1/image", hasImage = true)
        val confirmed = server.withPresentationOf(local)
        val refreshed = server.copy(readCount = 2).withPresentationOf(confirmed)
        assertEquals(local.presentationKey, confirmed.presentationKey)
        assertEquals(local.presentationKey, refreshed.presentationKey)
        assertEquals("server-1", refreshed.id)
        assertEquals(2, refreshed.readCount)
        assertFalse(refreshed.pending)
        assertNull(refreshed.content)
        assertEquals(server.imageUrl, refreshed.imageUrl)
        assertTrue(server.copy(recalled = true, hasImage = false).withPresentationOf(refreshed).recalled)
    }
}
