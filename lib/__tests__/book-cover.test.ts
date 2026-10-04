import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { strToU8, zipSync } from "fflate"
import { prepareBookCover, COVER_MAX_BYTES } from "@/lib/book-cover"
import { importEbook } from "@/lib/ebook-import"

async function image() {
  return sharp({
    create: { width: 30, height: 45, channels: 3, background: "#567482" },
  })
    .png()
    .toBuffer()
}
function epub(cover: Buffer, legacy = false) {
  return Buffer.from(
    zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="BOOK/book.opf"/></rootfiles></container>',
      ),
      "BOOK/book.opf": strToU8(
        `<package><metadata>${legacy ? '<meta name="cover" content="cover"/>' : ""}</metadata><manifest><item id="cover" href="cover.png" media-type="image/png" ${legacy ? "" : 'properties="cover-image"'}/><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>`,
      ),
      "BOOK/cover.png": cover,
      "BOOK/text.xhtml": strToU8(
        "<html><body><p>可阅读的正文</p></body></html>",
      ),
    }),
  )
}
describe("durable book covers", () => {
  it("decodes raster covers and emits a bounded JPEG usable by both clients", async () => {
    const result = await prepareBookCover(await image())
    expect(result.coverMime).toBe("image/jpeg")
    const info = await sharp(result.coverBytes).metadata()
    expect(info.format).toBe("jpeg")
    expect([info.width, info.height]).toEqual([30, 45])
    expect(info.exif).toBeUndefined()
  })
  it("rejects scripts, invalid image bytes and oversized uploads", async () => {
    await expect(
      prepareBookCover(Buffer.from('<svg onload="alert(1)"></svg>')),
    ).rejects.toThrow("PNG")
    await expect(
      prepareBookCover(Buffer.from([255, 216, 255, 0])),
    ).rejects.toThrow("无法解码")
    await expect(
      prepareBookCover(Buffer.alloc(COVER_MAX_BYTES + 1)),
    ).rejects.toThrow("3 MB")
  })
  it.each([false, true])(
    "imports actual EPUB 3/EPUB 2 covers (legacy=%s)",
    async (legacy) => {
      const result = await importEbook(epub(await image(), legacy), "book.epub")
      expect(result.readerText).toContain("可阅读的正文")
      expect(result.coverMime).toBe("image/jpeg")
      expect((await sharp(result.coverBytes!).metadata()).height).toBe(45)
    },
  )
  it("keeps valid EPUB text importable when its embedded cover is corrupt", async () => {
    const result = await importEbook(
      epub(Buffer.from("not an image")),
      "book.epub",
    )
    expect(result.readerText).toContain("可阅读的正文")
    expect(result.coverBytes).toBeNull()
  })
})
