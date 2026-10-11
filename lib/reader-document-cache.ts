import { buildReaderDocument, type ReaderDocument } from "@/lib/reader-document"
import { READER_CACHE_SCHEMA } from "@/lib/reader-identity"

const MAX_BYTES = 24 * 1024 * 1024
const MAX_ENTRIES = 8
const documents = new Map<string, { document: ReaderDocument; size: number }>()
const pending = new Map<string, Promise<ReaderDocument>>()

export class ReaderSourceChangedError extends Error {}

/** Shared content only. Callers must check current access before consulting this cache. */
export async function cachedReaderDocument(
  id: string,
  revision: string,
  format: string,
  loadBytes: () => Promise<Buffer>,
) {
  const key = `${READER_CACHE_SCHEMA}:${id}:${revision}:${format}`
  const cached = documents.get(key)
  if (cached) {
    documents.delete(key)
    documents.set(key, cached)
    return cached.document
  }
  const running = pending.get(key)
  if (running) return running
  const work = (async () => {
    const document = await buildReaderDocument(
      await loadBytes(),
      format,
      `/api/library/${id}/resource`,
    )
    const size = Buffer.byteLength(JSON.stringify(document))
    if (size <= MAX_BYTES) {
      documents.set(key, { document, size })
      while (
        documents.size > MAX_ENTRIES ||
        [...documents.values()].reduce((sum, item) => sum + item.size, 0) >
          MAX_BYTES
      ) {
        documents.delete(documents.keys().next().value!)
      }
    }
    return document
  })()
  // Bound pending bookkeeping as well as retained documents.
  if (pending.size < MAX_ENTRIES) pending.set(key, work)
  try {
    return await work
  } finally {
    if (pending.get(key) === work) pending.delete(key)
  }
}

/** Explicit allowlist: identity, progress and future personal fields never enter CDN storage. */
export function sharedReaderPayload(
  payload: { success: boolean; data?: Record<string, unknown> },
  revision: string,
) {
  const data = payload.data
  if (
    !payload.success ||
    !data ||
    data.revision !== revision ||
    data.version !== 1
  )
    throw new Error("Invalid reader snapshot")
  const shared: Record<string, unknown> = {}
  for (const key of [
    "version",
    "format",
    "chapters",
    "toc",
    "text",
    "pages",
    "styles",
    "startChapter",
    "layout",
    "renderMetadataVersion",
    "revision",
  ])
    if (Object.hasOwn(data, key)) shared[key] = data[key]
  return { success: true, data: shared }
}
