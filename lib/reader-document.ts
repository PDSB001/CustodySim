import { unzipSync } from "fflate"
import { XMLParser } from "fast-xml-parser"
import { convertToHtml } from "mammoth"
import { posix } from "node:path"
import { createHash } from "node:crypto"

export type ReaderChapter = {
  path: string
  title: string
  html: string
  text: string
  start: number
  length: number
  linear: boolean
  styles?: string
  viewportWidth?: number
  viewportHeight?: number
}
export type ReaderToc = {
  title: string
  chapter: number
  fragment: string
  depth: number
}
export type ReaderDocument = {
  version: 1
  chapters: ReaderChapter[]
  toc: ReaderToc[]
  text: string
  pages: number
  styles: string
  startChapter: number
  layout: "reflowable" | "fixed"
}
type Node = Record<string, unknown>
type ManifestItem = Record<string, string>
const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]
const allowed = new Set(
  "p div section article span h1 h2 h3 h4 h5 h6 br hr strong b em i u s sub sup blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption img a aside ruby rt rp small abbr address center".split(
    " ",
  ),
)
const dropped = new Set(
  "head script style iframe object embed form input button textarea select audio video canvas base link meta noscript".split(
    " ",
  ),
)
const blocks = new Set(
  "p div section article h1 h2 h3 h4 h5 h6 br li dt dd tr blockquote pre figure figcaption aside".split(
    " ",
  ),
)
export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  )
}

export function parseBookXml(source: string, ordered = false) {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source))
    throw new Error("电子书包含不支持的 XML 声明")
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    preserveOrder: ordered,
    parseTagValue: false,
    trimValues: false,
    htmlEntities: true,
    // Ordered parsing is used for HTML. OPF metadata uses a paired <meta> element.
    unpairedTags: ordered ? ["br", "hr", "img", "meta", "link", "input"] : [],
  }).parse(source.replace(/<!DOCTYPE[^>]*>/gi, ""))
}

export function openBookArchive(bytes: Buffer) {
  let total = 0,
    count = 0
  return unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize
      count++
      if (total > 40 * 1024 * 1024 || count > 2000)
        throw new Error("电子书解压后内容过大")
      return true
    },
  })
}

const resourceArchives = new Map<
  string,
  { files: Record<string, Uint8Array>; size: number }
>()
function resourceArchive(bytes: Buffer) {
  const key = createHash("sha256").update(bytes).digest("hex")
  const cached = resourceArchives.get(key)
  if (cached) {
    resourceArchives.delete(key)
    resourceArchives.set(key, cached)
    return cached.files
  }
  const files = openBookArchive(bytes),
    size = Object.values(files).reduce((n, f) => n + f.length, 0)
  resourceArchives.set(key, { files, size })
  while (
    resourceArchives.size > 2 ||
    [...resourceArchives.values()].reduce((n, v) => n + v.size, 0) >
      64 * 1024 * 1024
  ) {
    resourceArchives.delete(resourceArchives.keys().next().value!)
  }
  return files
}

/** Resolve only archive-relative paths. Never permit a network URL or ZIP traversal. */
export function resolveBookPath(base: string, href: string): string | null {
  if (
    !href ||
    /^[a-z][a-z0-9+.-]*:|^\/\/|^\//i.test(href) ||
    href.includes("\\")
  )
    return null
  try {
    const path = posix.normalize(
      posix.join(
        posix.dirname(base),
        decodeURIComponent(href.split(/[?#]/)[0]),
      ),
    )
    return path.startsWith("../") || path === ".." || path.includes("\0")
      ? null
      : path
  } catch {
    return null
  }
}

export function epubPackage(files: Record<string, Uint8Array>) {
  const read = (path: string) => {
    if (!files[path]) throw new Error(`电子书缺少必要内容：${path}`)
    return new TextDecoder("utf-8", { fatal: true }).decode(files[path])
  }
  if (read("mimetype").trim() !== "application/epub+zip")
    throw new Error("不是有效的 EPUB 文件")
  // Obfuscated fonts are optional resources, not DRM-encrypted reading content.
  if (files["META-INF/encryption.xml"]) {
    const encryption = read("META-INF/encryption.xml")
    const algorithms = [
      ...encryption.matchAll(/Algorithm\s*=\s*["']([^"']+)/g),
    ].map((m) => m[1])
    if (
      !algorithms.length ||
      algorithms.some(
        (a) =>
          ![
            "http://www.idpf.org/2008/embedding",
            "http://ns.adobe.com/pdf/enc#RC",
          ].includes(a),
      )
    )
      throw new Error("暂不支持 DRM 加密 EPUB，请上传无加密版本")
  }
  const roots = parseBookXml(read("META-INF/container.xml")).container
    ?.rootfiles?.rootfile
  const root = list<ManifestItem>(roots)[0]?.["@_full-path"]
  if (
    !root ||
    root.startsWith("/") ||
    root.includes("..") ||
    root.includes("\\")
  )
    throw new Error("EPUB 缺少有效的包目录")
  const book = parseBookXml(read(root)).package
  if (!book) throw new Error("EPUB 包文件无效")
  const manifest = list<ManifestItem>(book.manifest?.item)
  return { read, root, book, manifest }
}

// Retain typography and document geometry, excluding URLs, executable CSS and fixed overlays.
export function safeBookCss(source: string, fixed = false): string {
  const properties = new Set(
    "text-align text-indent font-style font-weight font-family font-size line-height letter-spacing word-spacing margin margin-top margin-bottom margin-left margin-right padding padding-top padding-bottom padding-left padding-right border border-top border-bottom border-collapse border-spacing vertical-align width max-width min-width height max-height display list-style-type white-space float clear writing-mode text-orientation break-before break-after page-break-before page-break-after".split(
      " ",
    ),
  )
  if (fixed)
    for (const property of "position top left right bottom transform transform-origin".split(" "))
      properties.add(property)
  if (source.length > 250_000) return ""
  return [
    ...source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ]
    .map((match) => {
      const selector = match[1].trim()
      if (
        /[@<>\\]|reader-|html|body/i.test(selector) ||
        !/^[\w\s.#,:>+~*\[\]="'()\-|]+$/.test(selector)
      )
        return ""
      const declarations = match[2].split(";").flatMap((entry) => {
        const split = entry.indexOf(":")
        if (split < 0) return []
        const property = entry.slice(0, split).trim().toLowerCase(),
          value = entry.slice(split + 1).trim()
        if (
          !properties.has(property) ||
          /url|expression|javascript|@|[<>\\]|!important|fixed|sticky/i.test(
            value,
          ) ||
          value.length > 160
        )
          return []
        return [`${property}:${value}`]
      })
      return declarations.length ? `${selector}{${declarations.join(";")}}` : ""
    })
    .join("\n")
}

function nodeText(nodes: unknown): string {
  return Array.isArray(nodes)
    ? nodes
        .map((node: Node) =>
          Object.entries(node)
            .map(([tag, value]) =>
              tag === "#text"
                ? String(value)
                : tag === ":@" || dropped.has(tag)
                  ? ""
                  : nodeText(value),
            )
            .join(""),
        )
        .join("")
    : ""
}
function findNodes(nodes: unknown, tag: string): Node[] {
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((node: Node) => [
    ...(node[tag] ? [node] : []),
    ...Object.entries(node)
      .filter(([key]) => key !== ":@")
      .flatMap(([, value]) => findNodes(value, tag)),
  ])
}

function sanitizeDocument(
  source: string,
  path: string,
  paths: Map<string, number>,
  asset: (path: string) => string | null,
  fixed = false,
) {
  const parsed = parseBookXml(source, true)
  const body = findNodes(parsed, "body")[0]?.body ?? parsed
  let offset = 0
  const walk = (
    nodes: unknown,
    preformatted = false,
  ): { html: string; text: string } => {
    if (!Array.isArray(nodes)) return { html: "", text: "" }
    let html = "",
      text = ""
    for (const node of nodes as Node[]) {
      for (const [tag, value] of Object.entries(node)) {
        if (tag === ":@" || dropped.has(tag)) continue
        if (tag === "#text") {
          const t = preformatted
              ? String(value)
              : String(value).replace(/[\t\r\n ]+/g, " "),
            chars = Array.from(t)
          for (let i = 0; i < chars.length; i += 100)
            html += `<span data-reader-text-offset="${offset + i}">${escapeHtml(chars.slice(i, i + 100).join(""))}</span>`
          text += t
          offset += chars.length
          continue
        }
        const attrs = (node[":@"] ?? {}) as Record<string, string>
        const type = attrs["@_type"] ?? ""
        if (tag === "nav" && /\b(toc|page-list|landmarks)\b/.test(type))
          continue
        // Calibre commonly wraps a cover bitmap in <svg><image xlink:href="..."/>.
        // Keep the manifest-whitelisted image, without allowing arbitrary SVG markup or scripts.
        if (tag === "image") {
          const resolved = resolveBookPath(path, attrs["@_href"] ?? "")
          const url = resolved ? asset(resolved) : null
          if (url)
            html += `<img src="${escapeHtml(url)}" alt="${escapeHtml(attrs["@_alt"] || "封面插图")}" loading="eager">`
          continue
        }
        if (blocks.has(tag)) {
          text += "\n"
          offset++
        }
        const child = walk(value, preformatted || tag === "pre")
        text += child.text
        if (blocks.has(tag)) {
          text += "\n"
          offset++
        }
        if (!allowed.has(tag)) {
          html += child.html
          continue
        }
        const clean: string[] = []
        for (const key of [
          "id",
          "class",
          "title",
          "alt",
          "colspan",
          "rowspan",
          "lang",
        ]) {
          const v = attrs[`@_${key}`]
          if (v && v.length < 500 && !/reader-/i.test(v))
            clean.push(`${key}="${escapeHtml(v)}"`)
        }
        if (attrs["@_style"]) {
          const style = safeBookCss(`x{${attrs["@_style"]}}`, fixed).replace(
            /^x\{|\}$/g,
            "",
          )
          if (style) clean.push(`style="${escapeHtml(style)}"`)
        }
        if (tag === "img") {
          const src = attrs["@_src"] ?? ""
          const resolved = resolveBookPath(path, src)
          const url = resolved
            ? asset(resolved)
            : /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(
                  src,
                ) && src.length <= 4_200_000
              ? src
              : null
          if (!url) {
            html += `<span class="reader-unavailable">${escapeHtml(attrs["@_alt"] || "插图暂不可用")}</span>`
            continue
          }
          clean.push(`src="${escapeHtml(url)}"`, 'loading="lazy"')
        }
        if (tag === "a") {
          const href = attrs["@_href"] ?? ""
          const target = href.startsWith("#")
            ? path
            : resolveBookPath(path, href)
          const chapter = target ? paths.get(target) : undefined
          if (chapter !== undefined) {
            let fragment = ""
            try {
              fragment = decodeURIComponent(href.split("#")[1] ?? "")
            } catch {
              /* malformed fragment */
            }
            clean.push(
              `href="https://reader.invalid/chapter/${chapter}#${encodeURIComponent(fragment)}"`,
            )
          }
        }
        html += `<${tag} ${clean.join(" ")}>${child.html}${["br", "hr", "img"].includes(tag) ? "" : `</${tag}>`}`
      }
    }
    return { html, text }
  }
  const result = walk(body)
  // Keep the raw offset stream for stable anchors; display-only whitespace is handled by HTML.
  return {
    ...result,
    title: nodeText(
      findNodes(body, "h1")[0]?.h1 ?? findNodes(body, "h2")[0]?.h2,
    ).trim(),
    length: offset,
  }
}

export async function buildReaderDocument(
  bytes: Buffer,
  format: string,
  assetPrefix = "",
): Promise<ReaderDocument> {
  let layout: ReaderDocument["layout"] = "reflowable"
  let sources: {
    path: string
    title: string
    source: string
    css: string
    linear: boolean
    viewportWidth?: number
    viewportHeight?: number
  }[] = []
  const toc: ReaderToc[] = []
  let assets: (path: string) => string | null = () => null
  let startPath: string | null = null
  if (format === "TXT") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    sources = [
      {
        path: "text",
        title: "正文",
        source: `<html><body>${text
          .split(/\r?\n\s*\r?\n/)
          .map(
            (paragraph) =>
              `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br/>")}</p>`,
          )
          .join("")}</body></html>`,
        css: "",
        linear: true,
      },
    ]
  } else {
    const files = openBookArchive(bytes)
    if (format === "DOCX") {
      if (!files["word/document.xml"]) throw new Error("不是有效的 DOCX 文件")
      parseBookXml(new TextDecoder().decode(files["word/document.xml"]))
      const converted = await convertToHtml({ buffer: bytes })
      sources = [
        {
          path: "document",
          title: "正文",
          source: `<html><body>${converted.value}</body></html>`,
          css: "",
          linear: true,
        },
      ]
    } else if (format === "EPUB") {
      const { root, book, manifest, read } = epubPackage(files)
      layout = list<Record<string, string>>(book.metadata?.meta).some(
        (m) =>
          m["@_property"] === "rendition:layout" &&
          m["#text"] === "pre-paginated",
      )
        ? "fixed"
        : "reflowable"
      const map = new Map(manifest.map((m) => [m["@_id"], m]))
      const nav = manifest.find((m) =>
        m["@_properties"]?.split(/\s+/).includes("nav"),
      )
      const guideToc = list<ManifestItem>(book.guide?.reference).find(
        (m) => m["@_type"] === "toc",
      )
      const guideStart = list<ManifestItem>(book.guide?.reference).find(
        (m) => m["@_type"] === "text",
      )
      startPath = guideStart
        ? resolveBookPath(root, guideStart["@_href"])
        : null
      const tocPath = guideToc
        ? resolveBookPath(root, guideToc["@_href"])
        : null
      const navPath = nav ? resolveBookPath(root, nav["@_href"]) : null
      const ordered = list<ManifestItem>(book.spine?.itemref).map((ref) => ({
        item: map.get(ref["@_idref"]),
        linear: ref["@_linear"] !== "no",
      }))
      // Auxiliary chapters remain link targets (notes), but navigation pages never become body text.
      sources = ordered.flatMap(({ item, linear }) => {
        if (
          !item ||
          !["application/xhtml+xml", "text/html"].includes(item["@_media-type"])
        )
          return []
        const path = resolveBookPath(root, item["@_href"])
        if (!path || path === tocPath || path === navPath || !files[path])
          return []
        const source = read(path),
          parsed = parseBookXml(source, true)
        const heading = nodeText(
          findNodes(parsed, "h1")[0]?.h1 ??
            findNodes(parsed, "h2")[0]?.h2 ??
            findNodes(parsed, "title")[0]?.title,
        ).trim()
        const anchors = findNodes(
          findNodes(parsed, "body")[0]?.body ?? parsed,
          "a",
        )
        const bodyText = nodeText(
          findNodes(parsed, "body")[0]?.body ?? parsed,
        ).replace(/\s+/g, "")
        const linkedText = anchors
          .map((n) => nodeText(n.a))
          .join("")
          .replace(/\s+/g, "")
        // Older EPUB2 exports often contain several unmarked, volume-specific TOC pages.
        if (
          (/^(总目录|目录|目次|contents|table of contents)$/i.test(heading) ||
            /^(总目录|目录|目次|contents|tableofcontents)/i.test(bodyText)) &&
          anchors.length > 1 &&
          linkedText.length >= bodyText.length * 0.45
        )
          return []
        const css =
          findNodes(parsed, "style")
            .map((n) => safeBookCss(nodeText(n.style), layout === "fixed"))
            .join("\n") +
          findNodes(parsed, "link")
            .map((n) => {
              const a = n[":@"] as ManifestItem | undefined
              const cssPath =
                a?.["@_rel"] === "stylesheet"
                  ? resolveBookPath(path, a["@_href"] ?? "")
                  : null
              return cssPath && files[cssPath] && cssPath.endsWith(".css")
                ? safeBookCss(read(cssPath), layout === "fixed")
                : ""
            })
            .join("\n")
        const viewport = findNodes(parsed, "meta").find((n) =>
          (n[":@"] as ManifestItem | undefined)?.["@_name"]?.toLowerCase() === "viewport",
        )?.[":@"] as ManifestItem | undefined
        const dimension = (name: string) => {
          const match = viewport?.["@_content"]?.match(new RegExp(`(?:^|[,;\\s])${name}\\s*=\\s*(\\d+)`, "i"))
          const value = Number(match?.[1])
          return Number.isInteger(value) && value > 0 && value <= 20000 ? value : undefined
        }
        return [
          {
            path,
            source,
            css,
            linear,
            title: nodeText(findNodes(parsed, "title")[0]?.title).trim(),
            viewportWidth: dimension("width"),
            viewportHeight: dimension("height"),
          },
        ]
      })
      const paths = new Map(sources.map((s, i) => [s.path, i]))
      const addToc = (
        title: string,
        href: string,
        base: string,
        depth: number,
      ) => {
        const path = resolveBookPath(base, href),
          chapter = path ? paths.get(path) : undefined
        if (chapter === undefined || !title.trim()) return
        let fragment = ""
        try {
          fragment = decodeURIComponent(href.split("#")[1] ?? "")
        } catch {
          /* invalid fragment */
        }
        toc.push({
          title: title.trim(),
          chapter,
          fragment,
          depth: Math.min(depth, 5),
        })
      }
      if (navPath && files[navPath]) {
        const parsed = parseBookXml(read(navPath), true)
        const navigation = findNodes(parsed, "nav").find((n) =>
          ((n[":@"] as ManifestItem)?.["@_type"] ?? "")
            .split(/\s+/)
            .includes("toc"),
        )
        const walkNav = (nodes: unknown, depth: number) => {
          if (!Array.isArray(nodes)) return
          for (const node of nodes as Node[])
            for (const [tag, children] of Object.entries(node)) {
              if (tag === ":@") continue
              if (tag === "a")
                addToc(
                  nodeText(children),
                  ((node[":@"] ?? {}) as ManifestItem)["@_href"] ?? "",
                  navPath,
                  depth,
                )
              walkNav(children, tag === "ol" ? depth + 1 : depth)
            }
        }
        walkNav(navigation?.nav ?? [], -1)
      }
      if (!toc.length) {
        const ncxItem =
          map.get(book.spine?.["@_toc"]) ??
          manifest.find((m) => m["@_media-type"] === "application/x-dtbncx+xml")
        const ncxPath = ncxItem
          ? resolveBookPath(root, ncxItem["@_href"])
          : null
        if (ncxPath && files[ncxPath]) {
          const walk = (points: unknown, depth: number) => {
            for (const point of list<Record<string, unknown>>(
              points as Record<string, unknown>,
            )) {
              const label = point.navLabel as { text?: string },
                content = point.content as ManifestItem
              addToc(
                String(label?.text ?? ""),
                content?.["@_src"] ?? "",
                ncxPath,
                depth,
              )
              if (point.navPoint) walk(point.navPoint, depth + 1)
            }
          }
          walk(parseBookXml(read(ncxPath)).ncx?.navMap?.navPoint, 0)
        }
      }
      const imagePaths = new Set(
        manifest
          .filter((m) =>
            /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(m["@_media-type"]),
          )
          .map((m) => resolveBookPath(root, m["@_href"])),
      )
      assets = (path) =>
        imagePaths.has(path) && files[path]
          ? `${assetPrefix}?path=${encodeURIComponent(path)}`
          : null
    } else throw new Error("此格式使用原始页面阅读")
  }
  const paths = new Map(sources.map((s, i) => [s.path, i]))
  let start = 0
  const chapters = sources.map((s, i) => {
    const result = sanitizeDocument(s.source, s.path, paths, assets, layout === "fixed")
    const chapter = {
      path: s.path,
      title:
        toc.find((t) => t.chapter === i)?.title ||
        result.title ||
        s.title ||
        `第 ${i + 1} 节`,
      html: result.html,
      text: result.text,
      start,
      length: result.length,
      styles: s.css,
      ...(s.viewportWidth ? { viewportWidth: s.viewportWidth } : {}),
      ...(s.viewportHeight ? { viewportHeight: s.viewportHeight } : {}),
      // A stripped navigation-only document must not remain as a blank reading section.
      // Keep its index stable for existing links and TOC entries.
      linear:
        s.linear && Boolean(result.text.trim() || result.html.includes("<img")),
    }
    if (chapter.linear) start += result.length
    return chapter
  })
  if (
    !chapters.length ||
    !chapters.some((c) => c.text.trim() || c.html.includes("<img"))
  )
    throw new Error("文件没有可阅读的正文")
  if (
    start > 2_000_000 ||
    chapters.reduce((n, c) => n + c.html.length, 0) > 12_000_000
  )
    throw new Error("电子书正文过长")
  const readableToc = toc.filter((entry) => {
    const chapter = chapters[entry.chapter]
    return chapter && (chapter.text.trim() || chapter.html.includes("<img"))
  })
  if (!readableToc.length)
    chapters.forEach((c, chapter) => {
      if (c.linear)
        readableToc.push({ title: c.title, chapter, fragment: "", depth: 0 })
    })
  return {
    version: 1,
    chapters,
    toc: readableToc,
    text: chapters
      .filter((c) => c.linear)
      .map((c) => c.text)
      .join(""),
    pages: Math.max(1, Math.ceil(start / 2000)),
    startChapter:
      chapters.findIndex((c) => c.path === startPath && c.linear) >= 0
        ? chapters.findIndex((c) => c.path === startPath && c.linear)
        : Math.max(
            0,
            chapters.findIndex((c) => c.linear),
          ),
    styles: [...new Set(sources.map((s) => s.css).filter(Boolean))].join("\n"),
    layout,
  }
}

export function readEpubResource(bytes: Buffer, path: string) {
  const files = resourceArchive(bytes)
  const { root, manifest } = epubPackage(files)
  const item = manifest.find((m) => resolveBookPath(root, m["@_href"]) === path)
  if (
    !item ||
    !files[path] ||
    !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(item["@_media-type"])
  )
    return null
  return { bytes: Buffer.from(files[path]), mime: item["@_media-type"] }
}
