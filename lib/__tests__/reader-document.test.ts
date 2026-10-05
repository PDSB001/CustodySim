import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import {
  buildReaderDocument,
  readEpubResource,
  resolveBookPath,
  safeBookCss,
} from "@/lib/reader-document"

function epub(extra: Record<string, string> = {}, legacy = false) {
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    "OPS/book.opf": `<package><metadata/><manifest><item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" ${legacy ? "" : 'properties="nav"'}/><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="image" href="images/picture.png" media-type="image/png"/></manifest><spine toc="ncx"><itemref idref="toc"/><itemref idref="first"/><itemref idref="second"/><itemref idref="notes" linear="no"/></spine>${legacy ? '<guide><reference type="toc" href="nav.xhtml"/></guide>' : ""}</package>`,
    "OPS/nav.xhtml":
      '<html><body><nav epub:type="toc"><ol><li><a href="first.xhtml#start">第一章</a><ol><li><a href="first.xhtml#detail">小节</a></li></ol></li><li><a href="second.xhtml">第二章</a></li></ol></nav></body></html>',
    "OPS/toc.ncx":
      '<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="first.xhtml#start"/><navPoint><navLabel><text>小节</text></navLabel><content src="first.xhtml#detail"/></navPoint></navPoint><navPoint><navLabel><text>第二章</text></navLabel><content src="second.xhtml"/></navPoint></navMap></ncx>',
    "OPS/first.xhtml":
      '<html><body><h1 id="start">第一章</h1><p>正文 <em>斜体</em> <strong>重点</strong> 00123</p><h2 id="detail">小节</h2><img src="images/picture.png" alt="插图"/><table><tr><td>单元格</td></tr></table><p><a href="notes.xhtml#n1">注1</a></p></body></html>',
    "OPS/second.xhtml":
      "<html><body><h1>第二章</h1><p>第二章正文😀</p></body></html>",
    "OPS/notes.xhtml":
      '<html><body><aside id="n1">脚注内容<a href="first.xhtml#start">返回</a></aside></body></html>',
    "OPS/images/picture.png": "image-fixture",
    ...extra,
  }
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([p, s]) => [p, strToU8(s)]),
      ),
    ),
  )
}

describe("structured document reader", () => {
  it("retains fixed-page geometry and safe positioning without executable CSS", async () => {
    const doc = await buildReaderDocument(epub({
      "OPS/book.opf": '<package><metadata><meta property="rendition:layout">pre-paginated</meta></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/></spine></package>',
      "OPS/first.xhtml": '<html><head><meta name="viewport" content="width=720, height=1080"/><style>.title{position:absolute;left:50px;top:60px;background:url(https://invalid.test/x)}</style></head><body><h1 class="title" style="position:absolute;left:50px;top:60px">固定页面</h1></body></html>',
    }), "EPUB")
    expect(doc.layout).toBe("fixed")
    expect(doc.chapters[0].viewportWidth).toBe(720)
    expect(doc.chapters[0].viewportHeight).toBe(1080)
    expect(doc.chapters[0].styles).toContain("position:absolute")
    expect(doc.chapters[0].html).toContain("left:50px")
    expect(doc.chapters[0].styles).not.toContain("invalid.test")
  })
  it("keeps chapter styles separate and rejects oversized viewport dimensions", async () => {
    const doc = await buildReaderDocument(epub({
      "OPS/first.xhtml": '<html><head><meta name="viewport" content="width=999999, height=1080"/><style>.title{color:red;font-size:20px}</style></head><body><p>第一页</p></body></html>',
      "OPS/second.xhtml": '<html><head><style>.title{font-size:30px}</style></head><body><p>第二页</p></body></html>',
    }), "EPUB")
    expect(doc.chapters[0].viewportWidth).toBeUndefined()
    expect(doc.chapters[0].styles).toContain("20px")
    expect(doc.chapters[0].styles).not.toContain("30px")
    expect(doc.chapters[1].styles).toContain("30px")
  })
  it.each([false, true])(
    "uses EPUB3 nav and EPUB2 NCX as navigation, never body (legacy=%s)",
    async (legacy) => {
      const doc = await buildReaderDocument(
        epub({}, legacy),
        "EPUB",
        "/resource",
      )
      expect(doc.chapters.map((c) => c.path)).toEqual([
        "OPS/first.xhtml",
        "OPS/second.xhtml",
        "OPS/notes.xhtml",
      ])
      expect(
        doc.toc.map((t) => [t.title, t.chapter, t.fragment, t.depth]),
      ).toEqual([
        ["第一章", 0, "start", 0],
        ["小节", 0, "detail", 1],
        ["第二章", 1, "", 0],
      ])
      expect(doc.text).not.toContain("脚注内容")
      expect(doc.chapters[2].linear).toBe(false)
    },
  )
  it("keeps images, tables, emphasis, heading anchors and cross-chapter notes", async () => {
    const doc = await buildReaderDocument(epub(), "EPUB", "/resource")
    expect(doc.chapters[0].html).toContain("<table")
    expect(doc.chapters[0].html).toContain("<em")
    expect(doc.chapters[0].html).toContain('id="start"')
    expect(doc.chapters[0].html).toContain(
      "/resource?path=OPS%2Fimages%2Fpicture.png",
    )
    expect(doc.chapters[0].html).toContain(
      "https://reader.invalid/chapter/2#n1",
    )
    expect(doc.chapters[0].text).toContain("00123")
    expect(doc.chapters[1].start).toBe(doc.chapters[0].length)
  })
  it("excludes older unmarked volume contents without dropping ordinary chapters", async () => {
    const doc = await buildReaderDocument(
      epub(
        {
          "OPS/first.xhtml":
            '<html><body><h1>总目录</h1><p><a href="second.xhtml#a">商品和货币</a></p><p><a href="second.xhtml#b">资本的流通过程</a></p></body></html>',
          "OPS/second.xhtml":
            "<html><body><h1>目录编制方法</h1><p>目录编制方法是本章讨论的正文，不能因为标题包含目录就被删除。</p></body></html>",
        },
        true,
      ),
      "EPUB",
    )
    expect(doc.chapters.map((c) => c.path)).toEqual([
      "OPS/second.xhtml",
      "OPS/notes.xhtml",
    ])
    expect(doc.text).not.toContain("总目录")
    expect(doc.text).toContain("不能因为标题包含目录就被删除")
  })
  it("keeps Calibre SVG-wrapped cover images without admitting external image URLs", async () => {
    const doc = await buildReaderDocument(
      epub({
        "OPS/first.xhtml":
          '<html><body><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="images/picture.png"/><image href="https://evil.test/cover.png"/></svg></body></html>',
      }),
      "EPUB",
      "/resource",
    )
    expect(doc.chapters[0].html).toContain(
      '<img src="/resource?path=OPS%2Fimages%2Fpicture.png"',
    )
    expect(doc.chapters[0].html).not.toMatch(/svg|xlink|evil\.test/)
    expect(doc.chapters[0].linear).toBe(true)
  })
  it("skips navigation shells in sequential reading and begins at a readable section", async () => {
    const doc = await buildReaderDocument(
      epub({
        "OPS/first.xhtml":
          '<html><body><div><nav epub:type="toc"><ol><li><a href="second.xhtml">第二章</a></li></ol></nav></div></body></html>',
      }),
      "EPUB",
    )
    expect(doc.chapters[0].linear).toBe(false)
    expect(doc.startChapter).toBe(1)
    expect(doc.chapters[1].start).toBe(0)
    expect(doc.toc.some((entry) => entry.chapter === 0)).toBe(false)
    expect(doc.text.trim()).toBe(doc.chapters[1].text.trim())
  })
  it("does not execute or fetch book scripts, event handlers, iframe, remote images or links", async () => {
    const doc = await buildReaderDocument(
      epub({
        "OPS/first.xhtml":
          '<html><body><script>alert(1)</script><iframe src="https://evil.test"/><p onclick="bad()">安全正文</p><img src="https://evil.test/tracker"/><a href="javascript:bad()">链接</a><style>p{background:url(https://evil.test)}</style></body></html>',
      }),
      "EPUB",
    )
    expect(doc.chapters[0].html).not.toMatch(
      /script|iframe|onclick|javascript:|evil\.test/,
    )
    expect(doc.chapters[0].text).toContain("安全正文")
  })
  it("retains safe CSS and removes network and overlay styling", () => {
    expect(
      safeBookCss(
        "p.center{text-align:center;font-style:italic;background:url(x);position:fixed}",
      ),
    ).toBe("p.center{text-align:center;font-style:italic}")
    expect(safeBookCss("@import url(x); body{display:none}")).toBe("")
  })
  it("rejects ZIP traversal and external resource paths", () => {
    expect(resolveBookPath("OPS/a.xhtml", "images/%E5%9B%BE.png")).toBe(
      "OPS/images/图.png",
    )
    for (const path of [
      "../../outside",
      "%2e%2e/%2e%2e/out",
      "https://evil.test",
      "//evil.test",
      "file:///etc/passwd",
      "..\\out",
    ])
      expect(resolveBookPath("OPS/a.xhtml", path)).toBeNull()
    expect(readEpubResource(epub(), "OPS/first.xhtml")).toBeNull()
    expect(readEpubResource(epub(), "OPS/images/picture.png")?.mime).toBe(
      "image/png",
    )
  })
  it("provides stable Unicode offsets without splitting a paragraph into artificial pages", async () => {
    const body = "😀中文".repeat(1000)
    const doc = await buildReaderDocument(
      epub({ "OPS/first.xhtml": `<html><body><p>${body}</p></body></html>` }),
      "EPUB",
    )
    expect(doc.chapters[0].length).toBe(Array.from(body).length + 2)
    expect(doc.chapters[0].html.match(/<p /g)).toHaveLength(1)
    expect(doc.chapters[0].html).toContain('data-reader-text-offset="101"')
    expect(doc.pages).toBeGreaterThan(1)
  })
  it("keeps plain TXT line breaks and escapes text markup", async () => {
    const doc = await buildReaderDocument(
      Buffer.from("第一段\n第二行\n\n<script>不是代码</script>"),
      "TXT",
    )
    expect(doc.chapters[0].html).toContain("<br")
    expect(doc.chapters[0].html).toContain("&lt;script&gt;")
  })
  it("allows font obfuscation while rejecting DRM and XML entities", async () => {
    await expect(
      buildReaderDocument(
        epub({
          "META-INF/encryption.xml":
            '<encryption><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></encryption>',
        }),
        "EPUB",
      ),
    ).resolves.toBeDefined()
    await expect(
      buildReaderDocument(
        epub({
          "META-INF/encryption.xml":
            '<encryption><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></encryption>',
        }),
        "EPUB",
      ),
    ).rejects.toThrow("DRM")
    await expect(
      buildReaderDocument(
        epub({
          "OPS/first.xhtml":
            '<!DOCTYPE html [<!ENTITY x "bad">]><html>&x;</html>',
        }),
        "EPUB",
      ),
    ).rejects.toThrow("XML")
  })
})
