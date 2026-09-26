package com.custodysim.app.location

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationTimingTest {
    @Test fun coldStartWithNoAttemptIsDue() {
        assertTrue(LocationTiming.isDue(1_000_000, 0, 900_000))
    }

    @Test fun foregroundPollingDoesNotDuplicateRecentCapture() {
        assertFalse(LocationTiming.isDue(1_060_000, 1_000_000, 900_000))
        assertFalse(LocationTiming.isDue(1_899_999, 1_000_000, 900_000))
        assertTrue(LocationTiming.isDue(1_900_000, 1_000_000, 900_000))
    }

    @Test fun coldStartBypassesRecentAttemptButOrdinaryResumeDoesNot() {
        assertTrue(LocationTiming.shouldCapture(true, 1_060_000, 1_000_000, 900_000))
        assertFalse(LocationTiming.shouldCapture(false, 1_060_000, 1_000_000, 900_000))
    }

    @Test fun fiveAndTenMinuteCadencesBecomeDueAtTheirOwnBoundary() {
        assertFalse(LocationTiming.isDue(1_299_999, 1_000_000, 300_000))
        assertTrue(LocationTiming.isDue(1_300_000, 1_000_000, 300_000))
        assertFalse(LocationTiming.isDue(1_599_999, 1_000_000, 600_000))
        assertTrue(LocationTiming.isDue(1_600_000, 1_000_000, 600_000))
    }

    @Test fun shortenedIntervalAndClockRollbackCannotStallCapture() {
        assertTrue(LocationTiming.isDue(1_900_000, 1_000_000, 900_000))
        assertFalse(LocationTiming.isDue(1_900_000, 1_000_000, 1_800_000))
        assertTrue(LocationTiming.isDue(999_999, 1_000_000, 900_000))
    }

    @Test fun cachedFixRequiresBothMonotonicAndWallClockFreshness() {
        assertTrue(LocationTiming.isFresh(1_000_000, 999_000, 10_000_000, 9_999_000))
        assertFalse(LocationTiming.isFresh(1_000_000, 699_999, 10_000_000, 9_999_000))
        assertFalse(LocationTiming.isFresh(1_000_000, 999_000, 10_000_000, 9_699_999))
        assertFalse(LocationTiming.isFresh(1_000_000, 1_000_001, 10_000_000, 9_999_000))
        assertFalse(LocationTiming.isFresh(1_000_000, 999_000, 10_000_000, 10_000_001))
        assertFalse(LocationTiming.isFresh(1_000_000, 0, 10_000_000, 9_999_000))
    }
}
