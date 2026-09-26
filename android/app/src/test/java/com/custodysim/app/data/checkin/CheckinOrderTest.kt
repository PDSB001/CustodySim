package com.custodysim.app.data.checkin

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class CheckinOrderTest {
    private val now = Instant.parse("2026-09-26T10:00:00Z").toEpochMilli()
    private fun slot(id: String, start: Long, end: Long, status: String = "PENDING") = CheckinSlot(
        taskId = id, ruleName = id, slotLabel = null,
        scheduleAt = Instant.ofEpochMilli(now + start).toString(),
        deadline = Instant.ofEpochMilli(now + end).toString(), status = status,
        needRemark = false, recordId = null, recordStatus = null, checkinAt = null,
        remark = null, recordPhotoUrl = null, makeupId = null, makeupStatus = null, makeupReason = null,
    )

    @Test fun activePrecedesUpcomingAndExpired() {
        val active = slot("active", -100, 100)
        assertEquals(active, firstCheckin(listOf(slot("future", 200, 300), slot("old", -300, -200), active), now))
    }

    @Test fun earliestUpcomingIsOnlyCandidate() {
        val first = slot("first", 100, 200)
        assertEquals(first, firstCheckin(listOf(slot("later", 300, 400), first), now))
    }

    @Test fun completionPromotesNextSlot() {
        val next = slot("next", 100, 200)
        assertEquals(next, firstCheckin(listOf(slot("done", -100, 50, "COMPLETED"), next), now))
    }

    @Test fun deadlineIsInclusiveThenMovesToHistory() {
        val current = slot("current", -100, 0)
        assertEquals(current, firstCheckin(listOf(current), now))
        assertNull(firstCheckin(listOf(current), now + 1))
        assertEquals("MISSED", current.displayStatus(now + 1))
    }

    @Test fun completedStatusIsPreservedAndInvalidTimesExcluded() {
        val done = slot("done", -100, -50, "COMPLETED")
        assertEquals("COMPLETED", done.displayStatus(now))
        assertNull(firstCheckin(listOf(done, slot("invalid", 200, 100)), now))
    }
}
