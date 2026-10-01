package com.custodysim.app.data.net

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class ProgressRequestBodyTest {
    @Test fun `reports intermediate percentages and preserves payload`() {
        val bytes = ByteArray(150_001) { (it % 251).toByte() }
        val updates = mutableListOf<Int>()
        val original = bytes.toRequestBody("application/json".toMediaType())
        val body = ProgressRequestBody(original, updates::add)
        val output = Buffer()
        body.writeTo(output)
        assertArrayEquals(bytes, output.readByteArray())
        assertEquals(original.contentType(), body.contentType())
        assertEquals(bytes.size.toLong(), body.contentLength())
        assertEquals(0, updates.first())
        assertEquals(100, updates.last())
        assertTrue(updates.any { it in 1..99 })
        assertTrue(updates.zipWithNext().all { (a, b) -> b > a })
    }

    @Test fun `authentication retry restarts progress and replays same body`() {
        val updates = mutableListOf<Int>()
        val body = ProgressRequestBody(ByteArray(40_000).toRequestBody(), updates::add)
        repeat(2) { body.writeTo(Buffer()) }
        assertEquals(2, updates.count { it == 0 })
        assertEquals(2, updates.count { it == 100 })
    }
}
