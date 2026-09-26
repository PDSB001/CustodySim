package com.custodysim.app.config

import org.junit.Assert.*
import org.junit.Test

class ServerEndpointTest {
    @Test fun canonicalOrigin() {
        assertEquals("https://example.com", ServerEndpoint.normalize("  HTTPS://EXAMPLE.com:443/  "))
        assertEquals("https://example.com:8443", ServerEndpoint.normalize("https://example.com:8443/"))
    }

    @Test fun rejectsUnsafeOrAmbiguousInput() {
        listOf("http://example.com", "example.com", "https://user:pass@example.com",
            "https://example.com/api", "https://example.com/?token=secret", "https://example.com/#fragment",
            "https://localhost", "https://127.0.0.1", "https://192.168.1.2", "https://server.local",
            "https://[::1]", "https://example.com\\evil").forEach {
            assertTrue("Should reject $it", runCatching { ServerEndpoint.normalize(it) }.isFailure)
        }
    }

    @Test fun newSessionNeverReusesQueueOrCredentials() {
        val a = ServerEndpoint.selected("https://a.example.com")
        val b = ServerEndpoint.selected("https://b.example.com")
        val backToA = ServerEndpoint.selected("https://a.example.com")
        assertEquals("wss://a.example.com", a.realtimeUrl)
        assertNotEquals(a.namespace, b.namespace)
        assertNotEquals(a.namespace, backToA.namespace)
    }
}
