export const BOOK_MAX_BYTES = 20 * 1024 * 1024
export const HEARTBEAT_SECONDS = 15

export function readingPoints(
  seconds: number,
  minutesPerPoint: number,
  dailyCap: number,
) {
  if (minutesPerPoint <= 0 || dailyCap <= 0) return 0
  return Math.min(
    dailyCap,
    Math.floor(Math.max(0, seconds) / (minutesPerPoint * 60)),
  )
}

// A late/replayed heartbeat never credits a whole offline/background interval.
export function creditedReadingSeconds(
  previous: Date,
  now: Date,
  active: boolean,
) {
  const elapsed = Math.floor((now.getTime() - previous.getTime()) / 1000)
  return active && elapsed > 0 && elapsed <= 25 ? elapsed : 0
}

export function validateBook(bytes: Uint8Array, filename: string) {
  if (!bytes.length || bytes.length > BOOK_MAX_BYTES)
    throw new Error("电子书大小须在 1 字节到 20 MB 之间")
  const extension = filename.split(".").pop()?.toLowerCase()
  if (
    (extension === "docx" || extension === "epub") &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 3 &&
    bytes[3] === 4
  )
    return extension === "docx" ? ("DOCX" as const) : ("EPUB" as const)
  if (
    extension === "pdf" &&
    new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
  )
    return "PDF" as const
  if (extension === "txt") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      if (text.includes("\u0000")) throw new Error()
      return "TXT" as const
    } catch {
      throw new Error("TXT 文件须使用 UTF-8 编码")
    }
  }
  throw new Error("请上传有效的 PDF、DOCX、EPUB 或 UTF-8 TXT 文件")
}
