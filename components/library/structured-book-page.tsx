"use client"

import { useEffect, useRef, useState } from "react"
import { z } from "zod"

export const ReadingDocumentSchema = z.object({
  version: z.literal(1),
  pages: z.number().int().positive(),
  startChapter: z.number().int().nonnegative(),
  styles: z.string(),
  toc: z
    .array(
      z.object({
        title: z.string(),
        chapter: z.number().int().nonnegative(),
        fragment: z.string(),
        depth: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  revision: z.string(),
  readerKey: z.string(),
  chapters: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
        html: z.string(),
        text: z.string(),
        start: z.number(),
        length: z.number(),
        linear: z.boolean(),
      }),
    )
    .min(1),
})
export type WebReadingDocument = z.infer<typeof ReadingDocumentSchema>

/** Isolate book CSS; only server-sanitized markup enters a script-disabled document. */
export function StructuredBookPage({
  document: book,
  chapter,
  fontSize,
  lineHeight,
  night,
  onNavigate,
  fragment = "",
  offset = 0,
  highlight = "",
  onPosition,
  navigationKey = 0,
}: {
  document: WebReadingDocument
  chapter: number
  fontSize: number
  lineHeight: number
  night: boolean
  onNavigate: (chapter: number, fragment: string) => void
  offset?: number
  highlight?: string
  onPosition?: (offset: number) => void
  navigationKey?: number
  fragment?: string
}) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(500)
  const section = book.chapters[chapter]
  useEffect(() => {
    const frame = iframe.current
    if (!frame) return
    let observer: ResizeObserver | undefined
    let cleanup = () => {}
    const attach = () => {
      cleanup()
      const doc = frame.contentDocument
      if (!doc) return
      const measure = () =>
        setHeight(
          Math.max(
            400,
            Math.ceil(doc.body.getBoundingClientRect().height + 32),
          ),
        )
      observer = new ResizeObserver(measure)
      observer.observe(doc.body)
      const click = (event: MouseEvent) => {
        const target = event.target as Element
        const link = target.closest?.("a")
        if (!link) return
        event.preventDefault()
        const href = new URL(link.href)
        const match =
          href.hostname === "reader.invalid" &&
          href.pathname.match(/^\/chapter\/(\d+)$/)
        if (match)
          onNavigate(Number(match[1]), decodeURIComponent(href.hash.slice(1)))
      }
      doc.addEventListener("click", click)
      measure()
      doc
        .querySelectorAll("mark[data-reader-search]")
        .forEach((mark) =>
          mark.replaceWith(doc.createTextNode(mark.textContent || "")),
        )
      doc.body.normalize()
      if (highlight) {
        const walker = doc.createTreeWalker(doc.body, 4)
        const nodes: Text[] = []
        while (walker.nextNode()) nodes.push(walker.currentNode as Text)
        let marked = 0
        for (const node of nodes) {
          const text = node.data
          if (!text.includes(highlight) || marked >= 200) continue
          const parts = text.split(highlight),
            replacement = doc.createDocumentFragment()
          parts.forEach((part, index) => {
            if (index) {
              const mark = doc.createElement("mark")
              mark.dataset.readerSearch = ""
              mark.textContent = highlight
              replacement.append(mark)
              marked++
            }
            replacement.append(doc.createTextNode(part))
          })
          node.replaceWith(replacement)
        }
      }
      const spans = Array.from(
        doc.querySelectorAll<HTMLElement>("[data-reader-text-offset]"),
      )
      const target = fragment
        ? doc.getElementById(fragment)
        : offset > 0
          ? spans.findLast(
              (span) => Number(span.dataset.readerTextOffset) <= offset,
            )
          : null
      const scroll = frame.closest<HTMLElement>("[data-reader-scroll]")
      const navigationFrame = requestAnimationFrame(() => {
        if (target && scroll) {
          // The outer reader scrolls; the expanded iframe itself stays at its origin.
          frame.contentWindow?.scrollTo(0, 0)
          scroll.scrollTo({
            top:
              scroll.scrollTop +
              frame.getBoundingClientRect().top +
              target.getBoundingClientRect().top -
              scroll.getBoundingClientRect().top -
              12,
          })
        }
      })
      let positionFrame = 0
      const reportPosition = () => {
        cancelAnimationFrame(positionFrame)
        cancelAnimationFrame(navigationFrame)
        positionFrame = requestAnimationFrame(() => {
          const top = scroll?.getBoundingClientRect().top ?? 0
          const frameTop = frame.getBoundingClientRect().top
          const first = spans.find(
            (span) => span.getBoundingClientRect().bottom + frameTop > top + 2,
          )
          if (first) onPosition?.(Number(first.dataset.readerTextOffset))
        })
      }
      scroll?.addEventListener("scroll", reportPosition, { passive: true })
      reportPosition()
      cleanup = () => {
        cancelAnimationFrame(positionFrame)
        scroll?.removeEventListener("scroll", reportPosition)
        observer?.disconnect()
        doc.removeEventListener("click", click)
      }
    }
    frame.addEventListener("load", attach)
    if (frame.contentDocument?.readyState === "complete") attach()
    return () => {
      cleanup()
      frame.removeEventListener("load", attach)
    }
  }, [
    onNavigate,
    section,
    fragment,
    offset,
    highlight,
    onPosition,
    navigationKey,
  ])
  const markup = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style>${book.styles}</style><style>
    html{color-scheme:${night ? "dark" : "light"}}body{display:flow-root;margin:0;background:transparent;color:${night ? "#e2ded5" : "#32312d"};font-family:'Noto Serif SC','Songti SC',SimSun,serif;font-size:${fontSize}px;line-height:${lineHeight};overflow-wrap:anywhere}
    img{max-width:100%;height:auto;max-height:none;object-fit:contain}p{margin:0 0 1em}h1,h2,h3{line-height:1.4}figure{margin:1em 0;text-align:center}table{max-width:100%;border-collapse:collapse}td,th{border:1px solid #8886;padding:.4em}a{color:#3478f6}pre{white-space:pre-wrap}mark[data-reader-search]{background:#f0cc70;color:inherit;border-radius:2px}
    </style></head><body>${section.html}</body></html>`
  return (
    <iframe
      ref={iframe}
      title={section.title}
      sandbox="allow-same-origin"
      srcDoc={markup}
      style={{ display: "block", width: "100%", height, border: 0 }}
    />
  )
}
