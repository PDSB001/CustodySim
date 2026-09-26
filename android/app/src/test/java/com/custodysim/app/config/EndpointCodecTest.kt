package com.custodysim.app.config

import com.custodysim.app.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Test

class EndpointCodecTest {
    @Test fun emptyDefaultIsSupported() {
        assertEquals("", EndpointCodec.decode(""))
    }

    @Test fun decodesUtf8BytesWithUnsignedMask() {
        // Two UTF-8 bytes for é (195, 169), masked with 167 and 198.
        assertEquals("é", EndpointCodec.decode("100,111"))
    }

    @Test fun publicBuildsHaveNoEmbeddedEndpoint() {
        if (BuildConfig.BUILD_TYPE in setOf("debug", "release")) {
            assertEquals("", BuildConfig.BASE_URL_ENCODED)
            assertEquals("", BuildConfig.REALTIME_URL_ENCODED)
            assertEquals(false, BuildConfig.NEEDS_LOCAL_NETWORK)
        }
    }
}
