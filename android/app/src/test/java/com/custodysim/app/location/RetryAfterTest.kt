package com.custodysim.app.location

import com.custodysim.app.data.net.retryAfterSeconds
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class RetryAfterTest {
    @Test fun secondsHeaderWins() { assertEquals(90L, retryAfterSeconds("90", "请在 12 秒后重试")) }
    @Test fun legacyServerMessage() { assertEquals(900L, retryAfterSeconds(null, "登录尝试过于频繁，请在 900 秒后重试")) }
    @Test fun httpDate() {
        assertEquals(60L, retryAfterSeconds("Fri, 25 Sep 2026 04:01:00 GMT", "", Instant.parse("2026-09-25T04:00:00Z").toEpochMilli()))
    }
    @Test fun invalidOrMissingHeader() { assertEquals(60L, retryAfterSeconds("oops", "限流")) }
    @Test fun boundedDuration() {
        assertEquals(1L, retryAfterSeconds("-1", ""))
        assertEquals(86400L, retryAfterSeconds("9999999999", ""))
    }
}
