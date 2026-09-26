package com.custodysim.app

import androidx.test.platform.app.InstrumentationRegistry
import com.custodysim.app.data.auth.TokenStore
import com.custodysim.app.data.location.PendingPoint
import com.custodysim.app.location.PendingPointStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** Uses disposable namespaces only: never reads or clears the user's current session. */
class ServerIsolationTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun credentialsAndLateResponsesCannotCrossServers() = runBlocking {
        val a = TokenStore(context, "test-${UUID.randomUUID()}")
        val b = TokenStore(context, "test-${UUID.randomUUID()}")
        try {
            a.saveTokens("access-a", "refresh-a")
            a.saveTrustedDevice("trusted-a")
            assertEquals("access-a", a.accessToken())
            assertNull(b.accessToken())
            assertNull(b.trustedDevice())
            b.saveTokens("access-b", "refresh-b")
            a.invalidate()
            // Simulate a login/refresh finishing after the old container was retired.
            a.saveTokens("late-access-a", "late-refresh-a")
            a.saveTrustedDevice("late-trusted-a")
            assertNull(a.accessToken())
            assertNull(a.refreshToken())
            assertNull(a.trustedDevice())
            assertEquals("access-b", b.accessToken())
        } finally { a.clear(); b.clear() }
    }

    @Test fun pendingLocationsRemainInTheirOriginalNamespace() = runBlocking {
        val aName = "test-${UUID.randomUUID()}"
        val bName = "test-${UUID.randomUUID()}"
        val a = PendingPointStore(context, aName)
        val b = PendingPointStore(context, bName)
        val captured = "2026-09-26T00:00:00Z"
        try {
            a.append(listOf(PendingPoint(31.0, 121.0, 10.0, captured)))
            assertEquals(1, a.size())
            assertEquals(0, b.size())
            a.discardAndClose()
            a.append(listOf(PendingPoint(31.0, 121.0, 10.0, captured)))
            assertEquals(0, a.size())
        } finally {
            a.remove(setOf(captured))
            java.io.File(context.filesDir, "pending_locations_$aName.json").delete()
            java.io.File(context.filesDir, "pending_locations_$bName.json").delete()
        }
    }
}
