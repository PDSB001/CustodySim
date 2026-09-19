package com.custodysim.app.data.media

import org.junit.Assert.assertEquals
import org.junit.Test

class ImagePipelineTest {

    @Test
    fun `小图不缩放`() {
        assertEquals(100 to 200, ImagePipeline.scaledSize(100, 200, 1600))
    }

    @Test
    fun `横图长边超限时等比缩小`() {
        assertEquals(1600 to 800, ImagePipeline.scaledSize(3200, 1600, 1600))
    }

    @Test
    fun `竖图长边超限时等比缩小`() {
        assertEquals(400 to 1600, ImagePipeline.scaledSize(1000, 4000, 1600))
    }

    @Test
    fun `非法输入原样返回`() {
        assertEquals(0 to 0, ImagePipeline.scaledSize(0, 0, 1600))
    }
}
