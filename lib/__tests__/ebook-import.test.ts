import { describe, expect, it } from "vitest"
import { zipSync, strToU8 } from "fflate"
import { importEbook } from "@/lib/ebook-import"
import { readingPoints } from "@/lib/library"

function archive(files: Record<string, string>) {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, strToU8(value)]),
      ),
    ),
  )
}
function epub() {
  return {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    "OEBPS/book.opf":
      '<package><manifest><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    "OEBPS/a.xhtml":
      "<!DOCTYPE html><html><head><title>不应成为正文</title></head><body><h1>第一章</h1><p>阅读 &amp; 思考</p><script>不可执行</script></body></html>",
    "OEBPS/b.xhtml": "<html><body><p>第二章 00123</p></body></html>",
  }
}
describe("ebook import and reading points", () => {
  it("awards one point per 15 minutes with a three point daily cap", () => {
    expect(
      [899, 900, 1800, 2700, 86400].map((seconds) =>
        readingPoints(seconds, 15, 3),
      ),
    ).toEqual([0, 1, 2, 3, 3])
  })
  it("extracts EPUB chapters in spine order and excludes scripts and metadata", async () => {
    const result = await importEbook(archive(epub()), "book.epub")
    expect(result.format).toBe("EPUB")
    expect(result.readerText).toContain("阅读 & 思考")
    expect(result.readerText!.indexOf("第一章")).toBeLessThan(
      result.readerText!.indexOf("第二章"),
    )
    expect(result.readerText).not.toContain("不可执行")
    expect(result.readerText).not.toContain("不应成为正文")
    expect(result.readerText).toContain("00123")
  })
  it("extracts DOCX paragraphs", async () => {
    const docx = archive({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文阅读第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>',
    })
    const result = await importEbook(docx, "book.docx")
    expect(result.format).toBe("DOCX")
    expect(result.readerText).toBe("中文阅读第一段\n\n第二段")
  })
  it("rejects disguised archives, DRM and entity declarations", async () => {
    await expect(
      importEbook(archive({ data: "bad" }), "fake.docx"),
    ).rejects.toThrow("DOCX")
    await expect(
      importEbook(
        archive({ ...epub(), "META-INF/encryption.xml": "encrypted" }),
        "locked.epub",
      ),
    ).rejects.toThrow("加密")
    await expect(
      importEbook(
        archive({
          ...epub(),
          "OEBPS/a.xhtml":
            '<!DOCTYPE html [<!ENTITY x "bad">]><html>&x;</html>',
        }),
        "bad.epub",
      ),
    ).rejects.toThrow("XML")
  })
})
