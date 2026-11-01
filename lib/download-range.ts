/** Single byte ranges support resume without multipart buffering. */
export function parseDownloadRange(value: string | null, size: number) {
  if (!value) return null
  // Unsupported units and multiple ranges may be ignored in favor of the full file.
  if (!value.startsWith("bytes=") || value.includes(",")) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || size === 0)
    return "unsatisfiable" as const
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      return "unsatisfiable" as const
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return "unsatisfiable" as const
  return { start, end: Math.min(end, size - 1) }
}
