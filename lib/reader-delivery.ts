import { gzip } from "node:zlib"
import { promisify } from "node:util"

const compress = promisify(gzip)
export const READER_REPRESENTATION_HEADER = "X-CustodySim-Reader-Representation"

/** Only use with an already allowlisted public reader snapshot. */
export async function sharedReaderResponse(
  payload: unknown,
  headers: Headers,
  representation: string | null,
) {
  const result = new Headers(headers)
  result.delete("Content-Length")
  result.delete("Content-Encoding")
  result.delete("Transfer-Encoding")
  result.delete("ETag")
  if (representation !== "gzip-v1") {
    result.set(READER_REPRESENTATION_HEADER, "identity-v1")
    return Response.json(payload, { headers: result })
  }
  const bytes = await compress(Buffer.from(JSON.stringify(payload)), {
    level: 6,
  })
  // This is an opaque internal file, not an HTTP-encoded response. Fetch/cache
  // intermediaries must not decode it. The edge labels it gzip only for delivery.
  result.set("Content-Type", "application/octet-stream")
  result.set("Content-Length", String(bytes.byteLength))
  result.set("Cache-Control", "private, no-store, no-transform")
  result.set(READER_REPRESENTATION_HEADER, "gzip-v1")
  return new Response(new Uint8Array(bytes), { headers: result })
}
