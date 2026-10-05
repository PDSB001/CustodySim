import { unzipSync } from "fflate"
import { XMLParser } from "fast-xml-parser"
import { extractRawText } from "mammoth"
import { posix } from "node:path"
import { validateBook } from "@/lib/library"
import { prepareBookCover } from "@/lib/book-cover"
import { buildReaderDocument, epubPackage } from "@/lib/reader-document"

type ImportedEbook = {
  format: "PDF" | "TXT" | "DOCX" | "EPUB"
  readerText: string | null
  coverBytes: Buffer | null
  coverMime: string | null
}

function xml(source: string, ordered = false) {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source))
    throw new Error("电子书包含不支持的 XML 声明")
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    preserveOrder: ordered,
    parseTagValue: false,
    htmlEntities: true,
  }).parse(source.replace(/<!DOCTYPE[^>]*>/gi, ""))
}

export async function importEbook(
  bytes: Buffer,
  filename: string,
): Promise<ImportedEbook> {
  const format = validateBook(bytes, filename)
  const noCover = { coverBytes: null, coverMime: null }
  if (format === "PDF") return { format, readerText: null, ...noCover }
  if (format === "TXT")
    return { format, readerText: bytes.toString("utf8"), ...noCover }
  let total = 0,
    count = 0
  const files = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize
      count++
      if (total > 40 * 1024 * 1024 || count > 2000)
        throw new Error("电子书解压后内容过大")
      return true
    },
  })
  const read = (path: string) => {
    if (!files[path]) throw new Error(`电子书缺少必要内容：${path}`)
    return new TextDecoder("utf-8", { fatal: true }).decode(files[path])
  }
  let readerText: string
  let coverPath: string | undefined
  if (format === "DOCX") {
    if (!files["word/document.xml"] || !files["[Content_Types].xml"])
      throw new Error("不是有效的 DOCX 文件")
    xml(read("word/document.xml"))
    readerText = (await extractRawText({ buffer: bytes })).value.trim()
    coverPath = Object.keys(files).find((path) =>
      /^docProps\/thumbnail\.(png|jpe?g|webp)$/i.test(path),
    )
  } else {
    const { root, book } = epubPackage(files)
    const list = <T>(value: T | T[]): T[] =>
      Array.isArray(value) ? value : value ? [value] : []
    const manifest = new Map(
      list<Record<string, string>>(book.manifest?.item).map((item) => [
        item["@_id"],
        item,
      ]),
    )
    const legacyCover = list<Record<string, string>>(book.metadata?.meta).find(
      (item) => item["@_name"] === "cover",
    )?.["@_content"]
    const coverItem =
      [...manifest.values()].find((item) =>
        item["@_properties"]?.split(/\s+/).includes("cover-image"),
      ) ?? (legacyCover ? manifest.get(legacyCover) : undefined)
    if (
      coverItem?.["@_href"] &&
      ["image/jpeg", "image/png", "image/webp"].includes(
        coverItem["@_media-type"],
      )
    ) {
      coverPath = posix.normalize(
        posix.join(
          posix.dirname(root),
          decodeURIComponent(coverItem["@_href"].split("#")[0]),
        ),
      )
    }
    readerText = (await buildReaderDocument(bytes, format)).text.trim()
  }
  if (!readerText.trim()) throw new Error("文件没有可阅读的正文")
  if (readerText.length > 2_000_000) throw new Error("电子书正文过长")
  // An invalid embedded thumbnail must not prevent importing valid book text.
  const cover =
    coverPath && files[coverPath]
      ? await prepareBookCover(Buffer.from(files[coverPath])).catch(
          () => noCover,
        )
      : noCover
  return { format, readerText, ...cover }
}
