type ReaderEnvelope = {
  success?: boolean
  data?: unknown
  error?: { message?: string }
}

/** Retry a broken edge transfer once through the original, authenticated handler. */
export async function fetchReaderDocument(bookId: string, signal: AbortSignal) {
  const path = `/api/library/${bookId}/document`
  let response: Response | undefined
  try {
    response = await fetch(path, {
      signal,
      headers: { "X-CustodySim-Reader-Delivery": "shared-v1" },
    })
    if (!response.ok) throw new Error("书籍加载失败或已下架")
    const payload = (await response.json()) as ReaderEnvelope
    if (response.headers.get("X-CustodySim-Reader-Delivery") !== "shared-v1")
      return payload // Compatible with the original origin and older edge functions.
    const readerKey = response.headers.get("X-CustodySim-Reader-Key") ?? ""
    const revision = response.headers.get("X-CustodySim-Media-Revision")
    const data = payload.data
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
    if (!transportFailure && !brokenCachedJson) throw failure
    // No stored authorization or bytes are used for recovery. The same session is
    // checked again, so revocation during the failed transfer is still enforced.
    const origin = await fetch(`${path}?delivery=origin`, { signal })
    if (!origin.ok) throw new Error("书籍加载失败或已下架")
    return (await origin.json()) as ReaderEnvelope
  }
}
