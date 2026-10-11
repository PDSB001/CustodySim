import { afterEach, expect, test, vi } from "vitest"
import { fetchReaderDocument } from "@/lib/reader-document-fetch"

afterEach(() => vi.unstubAllGlobals())

test.each([500, 502, 503, 504, 545])(
  "HTTP %s retries the authenticated origin once",
  async (status) => {
    const payload = { success: true, data: { readerKey: "current-user" } }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Error return from script", { status }),
      )
      .mockResolvedValueOnce(Response.json(payload))
    vi.stubGlobal("fetch", fetch)
    expect(
      await fetchReaderDocument("book", new AbortController().signal),
    ).toEqual(payload)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe("/api/library/book/document-origin")
  },
)

test("HTTP 545 recovery respects revocation and does not retry a failed origin", async () => {
  for (const status of [403, 545]) {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 545 }))
      .mockResolvedValueOnce(new Response(null, { status }))
    vi.stubGlobal("fetch", fetch)
    await expect(
      fetchReaderDocument("book", new AbortController().signal),
    ).rejects.toThrow("已下架")
    expect(fetch).toHaveBeenCalledTimes(2)
  }
})

test("shared body identity comes from the current authorized response headers", async () => {
  const body = {
    success: true,
    data: { revision: "0123456789abcdef01234567", text: "中文📚正文" },
  }
  const fetch = vi.fn().mockImplementation(async () =>
    Response.json(body, {
      headers: {
        "X-CustodySim-Reader-Delivery": "shared-v1",
        "X-CustodySim-Reader-Key": "111111111111111111111111",
        "X-CustodySim-Media-Revision": body.data.revision,
      },
    }),
  )
  vi.stubGlobal("fetch", fetch)
  expect(
    await fetchReaderDocument("book", new AbortController().signal),
  ).toEqual({
    ...body,
    data: { ...body.data, readerKey: "111111111111111111111111" },
  })
  expect(body.data).not.toHaveProperty("readerKey")
  expect(fetch).toHaveBeenCalledTimes(1)
})

test.each(["missing", "mismatched", "personal"])(
  "invalid %s shared identity recovers only through the authenticated origin",
  async (mode) => {
    const response = Response.json(
      {
        success: true,
        data: {
          revision: "0123456789abcdef01234567",
          ...(mode === "personal" ? { readerKey: "wrong-user" } : {}),
        },
      },
      {
        headers: {
          "X-CustodySim-Reader-Delivery": "shared-v1",
          ...(mode === "missing"
            ? {}
            : { "X-CustodySim-Reader-Key": "111111111111111111111111" }),
          "X-CustodySim-Media-Revision":
            mode === "mismatched"
              ? "abcdef0123456789abcdef01"
              : "0123456789abcdef01234567",
        },
      },
    )
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal("fetch", fetch)
    await expect(
      fetchReaderDocument("book", new AbortController().signal),
    ).rejects.toThrow("已下架")
    expect(fetch).toHaveBeenCalledTimes(2)
  },
)

test("a HIT with a broken body retries once with the same abort signal", async () => {
  const broken = new Response(null, {
    headers: { "X-CustodySim-Media-Cache": "HIT" },
  })
  broken.json = async () => {
    throw new TypeError("Failed to fetch")
  }
  const payload = { success: true, data: { readerKey: "current-user" } }
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(broken)
    .mockResolvedValueOnce(Response.json(payload))
  vi.stubGlobal("fetch", fetch)
  const { signal } = new AbortController()
  expect(await fetchReaderDocument("book", signal)).toEqual(payload)
  expect(fetch.mock.calls).toEqual([
    [
      "/api/library/book/document",
      { signal, headers: { "X-CustodySim-Reader-Delivery": "shared-v1" } },
    ],
    ["/api/library/book/document-origin", { signal }],
  ])
})

test("a recovery request still rejects access revoked during the failed transfer", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
  vi.stubGlobal("fetch", fetch)
  await expect(
    fetchReaderDocument("book", new AbortController().signal),
  ).rejects.toThrow("已下架")
  expect(fetch).toHaveBeenCalledTimes(2)
})

test("access denial and user cancellation do not start recovery", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  vi.stubGlobal("fetch", fetch)
  await expect(
    fetchReaderDocument("book", new AbortController().signal),
  ).rejects.toThrow("已下架")
  expect(fetch).toHaveBeenCalledTimes(1)
  const abort = new AbortController()
  fetch.mockReset().mockImplementationOnce(async () => {
    abort.abort()
    throw new TypeError("Failed to fetch")
  })
  await expect(fetchReaderDocument("book", abort.signal)).rejects.toThrow(
    "Failed to fetch",
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})

test("truncated cached JSON recovers but malformed origin JSON does not loop", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('{"success":', {
        headers: { "X-CustodySim-Media-Cache": "HIT" },
      }),
    )
    .mockResolvedValueOnce(new Response('{"success":'))
  vi.stubGlobal("fetch", fetch)
  await expect(
    fetchReaderDocument("book", new AbortController().signal),
  ).rejects.toBeInstanceOf(SyntaxError)
  expect(fetch).toHaveBeenCalledTimes(2)
  fetch.mockReset().mockResolvedValueOnce(new Response('{"success":'))
  await expect(
    fetchReaderDocument("book", new AbortController().signal),
  ).rejects.toBeInstanceOf(SyntaxError)
  expect(fetch).toHaveBeenCalledTimes(1)
})
