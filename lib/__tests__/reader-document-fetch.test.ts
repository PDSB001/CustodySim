import { afterEach, expect, test, vi } from "vitest"
import { fetchReaderDocument } from "@/lib/reader-document-fetch"

afterEach(() => vi.unstubAllGlobals())

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
    ["/api/library/book/document", { signal }],
    ["/api/library/book/document?delivery=origin", { signal }],
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
