import { randomUUID } from "node:crypto"
import { expect, test, vi } from "vitest"
import {
  cachedReaderDocument,
  sharedReaderPayload,
} from "@/lib/reader-document-cache"

test("unchanged books reuse parsed content without loading bytes; replacement uses a new snapshot", async () => {
  const id = randomUUID()
  const load = vi.fn(async () => Buffer.from("第一版正文"))
  const first = await cachedReaderDocument(id, "rev1", "TXT", load)
  expect(await cachedReaderDocument(id, "rev1", "TXT", load)).toBe(first)
  expect(load).toHaveBeenCalledTimes(1)
  const second = await cachedReaderDocument(id, "rev2", "TXT", async () =>
    Buffer.from("第二版正文"),
  )
  expect(second.text).toContain("第二版")
  expect(first.text).toContain("第一版")
})

test("simultaneous openings share the first parse but failed loads can retry", async () => {
  const id = randomUUID()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const load = vi.fn(async () => {
    await gate
    return Buffer.from("正文")
  })
  const first = cachedReaderDocument(id, "rev", "TXT", load)
  const second = cachedReaderDocument(id, "rev", "TXT", load)
  release()
  const [a, b] = await Promise.all([first, second])
  expect(a).toBe(b)
  expect(load).toHaveBeenCalledTimes(1)
  const failedId = randomUUID()
  await expect(
    cachedReaderDocument(failedId, "rev", "TXT", async () => {
      throw new Error("unavailable")
    }),
  ).rejects.toThrow("unavailable")
  expect(
    (
      await cachedReaderDocument(failedId, "rev", "TXT", async () =>
        Buffer.from("恢复"),
      )
    ).text,
  ).toContain("恢复")
})

test("shared snapshot strips current and future personal fields, and checks its version", () => {
  const data = {
    version: 1,
    revision: "rev",
    chapters: [],
    readerKey: "private",
    progress: 4,
    futurePersonalData: "private",
    renderMetadataVersion: 1,
  }
  const shared = sharedReaderPayload({ success: true, data }, "rev")
  expect(shared.data).toEqual({
    version: 1,
    revision: "rev",
    chapters: [],
    renderMetadataVersion: 1,
  })
  expect(data.readerKey).toBe("private")
  expect(() => sharedReaderPayload({ success: true, data }, "other")).toThrow()
})
