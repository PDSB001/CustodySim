type ReaderEnvelope = {
  success?: boolean
  data?: unknown
  error?: { message?: string }
}

async function readerPayload(response: Response, signal: AbortSignal) {
  if (response.headers.get("X-CustodySim-Reader-Representation") !== "gzip-v1")
    return (await response.json()) as ReaderEnvelope
  // Fetch usually decodes HTTP gzip, but EdgeOne can deliver the opaque cached
  // file with its custom representation header and no Content-Encoding. Inspect
  // actual bytes so both raw gzip and already decoded JSON work without guessing.
  const bytes = new Uint8Array(await response.arrayBuffer())
  signal.throwIfAborted()
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    return (await new Response(bytes).json()) as ReaderEnvelope
  try {
    if (typeof DecompressionStream !== "function")
      throw new TypeError("Gzip reader decoding unavailable")
    const stream = new Response(bytes).body!.pipeThrough(
      new DecompressionStream("gzip"),
      { signal },
    )
    return (await new Response(stream).json()) as ReaderEnvelope
  } catch (error) {
    signal.throwIfAborted()
    // Runtime-specific decompression errors still use authenticated recovery.
    throw new TypeError("Invalid gzip reader body", { cause: error })
  }
}

/** Retry a broken edge transfer once through the original, authenticated handler. */
export async function fetchReaderDocument(bookId: string, signal: AbortSignal) {
  const path = `/api/library/${bookId}/document`
  let response: Response | undefined
  let stage = "fetch"
  try {
    response = await fetch(path, {
      signal,
      headers: { "X-CustodySim-Reader-Delivery": "shared-v1" },
    })
    if (!response.ok) throw new Error("书籍加载失败或已下架")
    stage = "body"
    const payload = await readerPayload(response, signal)
    if (response.headers.get("X-CustodySim-Reader-Delivery") !== "shared-v1")
      return payload // Compatible with the original origin and older edge functions.
    const readerKey = response.headers.get("X-CustodySim-Reader-Key") ?? ""
    const revision = response.headers.get("X-CustodySim-Media-Revision")
    const data = payload.data
    stage = "identity"
    if (
      !payload.success ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !/^[0-9a-f]{24}$/.test(readerKey) ||
      !revision ||
      !("revision" in data) ||
      data.revision !== revision ||
      Object.hasOwn(data, "readerKey")
    )
      throw new TypeError("Invalid shared reader identity")
    return { ...payload, data: { ...data, readerKey } }
  } catch (failure) {
    if (signal.aborted) throw failure
    const transportFailure = failure instanceof TypeError
    const brokenCachedJson =
      failure instanceof SyntaxError &&
      response?.headers.has("X-CustodySim-Media-Cache")
    const serverFailure =
      response && response.status >= 500 && response.status <= 599
    if (!transportFailure && !brokenCachedJson && !serverFailure) throw failure
    // No stored authorization or bytes are used for recovery. The same session is
    // checked again, so revocation during the failed transfer is still enforced.
    const origin = await fetch(`/api/library/${bookId}/document-origin`, {
      signal,
      headers: {
        "X-CustodySim-Reader-Recovery-Reason": serverFailure
          ? "http-5xx"
          : stage === "identity"
            ? "shared-identity"
            : failure instanceof SyntaxError
              ? "invalid-json"
              : "body-transfer",
      },
    })
    if (!origin.ok) throw new Error("书籍加载失败或已下架")
    return (await origin.json()) as ReaderEnvelope
  }
}
