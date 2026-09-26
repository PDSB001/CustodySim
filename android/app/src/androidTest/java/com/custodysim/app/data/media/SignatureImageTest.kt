package com.custodysim.app.data.media

import android.graphics.Color
import android.util.Base64
import androidx.compose.ui.geometry.Offset
import com.custodysim.app.ui.mine.encodeSignature
import org.junit.Assert.*
import org.junit.Test

/** Uses Android's real Canvas/font/PNG implementation, not JVM Bitmap mocks. */
class SignatureImageTest {
    private fun svgData(svg: String) = "data:image/svg+xml;base64," +
        Base64.encodeToString(svg.toByteArray(), Base64.NO_WRAP)

    @Test fun formattedSignatureRendersChineseText() {
        // Same SVG structure as lib/signature-server.ts; no image or path substitutes for text.
        val data = svgData("""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><rect width="640" height="200" fill="#fff"/><path d="M36 160H604" stroke="#cbd5e1" stroke-width="2"/><text x="320" y="132" text-anchor="middle" fill="#172554" font-size="84" font-family="STXingkai, KaiTi, 'Segoe Print', cursive">测试姓名</text></svg>""")
        val bitmap = requireNotNull(decodeDataUrlBitmap(data, 640))
        try {
            assertEquals(640, bitmap.width)
            assertEquals(200, bitmap.height)
            var ink = 0
            for (y in 30 until 145) for (x in 40 until 600) {
                if (Color.red(bitmap.getPixel(x, y)) < 100) ink++
            }
            assertTrue("Chinese signature text must actually paint, not just its baseline", ink > 100)
        } finally { bitmap.recycle() }
    }

    @Test fun svgPreviewIsBoundedAndKeepsAspectRatio() {
        val bitmap = requireNotNull(decodeDataUrlBitmap(svgData(
            """<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="red"/></svg>"""), 512))
        try {
            assertEquals(512, bitmap.width)
            assertEquals(160, bitmap.height)
            assertEquals(Color.RED, bitmap.getPixel(256, 80))
        } finally { bitmap.recycle() }
    }

    @Test fun handwritingRoundTripsWithServerCompatiblePng() {
        val data = encodeSignature(listOf(listOf(Offset(.1f, .5f), Offset(.9f, .5f))))
        assertTrue(data.startsWith("data:image/png;base64,"))
        assertTrue(data.length <= 750_000)
        val bitmap = requireNotNull(decodeDataUrlBitmap(data, 1024))
        try {
            assertEquals(960, bitmap.width)
            assertEquals(400, bitmap.height)
            assertEquals(Color.rgb(23, 37, 84), bitmap.getPixel(480, 200))
            assertEquals(Color.WHITE, bitmap.getPixel(480, 40))
        } finally { bitmap.recycle() }
    }

    @Test fun malformedImagesFailGracefully() {
        assertNull(decodeDataUrlBitmap(null, 512))
        assertNull(decodeDataUrlBitmap("data:image/png;base64,garbage", 512))
        assertNull(decodeDataUrlBitmap(svgData("<svg"), 512))
    }
}
