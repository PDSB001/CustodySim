import { createHash } from "node:crypto"

export const READER_CACHE_SCHEMA = "reader-schema-3-v1"

export function readerKey(userId: string, bookId: string) {
  return createHash("sha256")
    .update(`${userId}:${bookId}`)
    .digest("hex")
    .slice(0, 24)
}
