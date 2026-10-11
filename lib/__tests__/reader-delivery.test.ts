import { gunzipSync } from "node:zlib"
import { expect, test } from "vitest"
import { sharedReaderResponse } from "@/lib/reader-delivery"
import { sharedReaderPayload } from "@/lib/reader-document-cache"

test("origin compresses only the allowlisted snapshot and clears stale framing headers", async () => {
  const text = '中文正文📚\\"\n'.repeat(100000)
  const payload = sharedReaderPayload(
    {
      success: true,
      data: {
        version: 1,
        revision: "rev",
        text,
        readerKey: "private-user",
        progress: 45,
      },
    },
    "rev",
  )
  const headers = new Headers({
    "Content-Length": "123",
    "Content-Encoding": "br",
    ETag: "old",
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  })
  const response = await sharedReaderResponse(payload, headers, "gzip-v1")
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream")
  expect(response.headers.get("X-CustodySim-Reader-Representation")).toBe(
    "gzip-v1",
  )
  expect(response.headers.has("Content-Encoding")).toBe(false)
  expect(response.headers.has("ETag")).toBe(false)
  const bytes = Buffer.from(await response.arrayBuffer())
  expect(response.headers.get("Content-Length")).toBe(String(bytes.length))
  expect(bytes.length).toBeLessThan(Buffer.byteLength(text) / 10)
  const decoded = JSON.parse(gunzipSync(bytes).toString())
  expect(decoded.data.text).toBe(text)
  expect(decoded.data.readerKey).toBeUndefined()
  expect(decoded.data.progress).toBeUndefined()
  expect(headers.get("Content-Encoding")).toBe("br")
})

test.each([null, "identity-v1", "unknown"])(
  "origin keeps %s compatible with uncompressed clients",
  async (representation) => {
    const body = { success: true, data: { text: "正文" } }
    const response = await sharedReaderResponse(
      body,
      new Headers({ "Cache-Control": "private, no-store" }),
      representation,
    )
    expect(response.headers.has("Content-Encoding")).toBe(false)
    expect(response.headers.get("X-CustodySim-Reader-Representation")).toBe(
      "identity-v1",
    )
    expect(await response.json()).toEqual(body)
  },
)
