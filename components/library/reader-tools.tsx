"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { z } from "zod"
import { BookmarkPlus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { WebReadingDocument } from "./structured-book-page"
import styles from "./library.module.css"

export type ReaderPanel = "contents" | "search" | "bookmarks" | null
const BookmarkSchema = z
  .array(
    z.object({
      chapter: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      title: z.string(),
      fragment: z.string().default(""),
    }),
  )
  .max(200)
type Bookmark = z.infer<typeof BookmarkSchema>[number]
type Match = Bookmark & { excerpt: string }

export function ReaderTools({
  panel,
  onClose,
  document: book,
  pdf,
  storageKey,
  chapter,
  offset,
  onNavigate,
}: {
  panel: ReaderPanel
  onClose: () => void
  document: WebReadingDocument | null
  pdf: PDFDocumentProxy | null
  storageKey: string
  chapter: number
  offset: number
  onNavigate: (
    chapter: number,
    fragment: string,
    offset?: number,
    highlight?: string,
  ) => void
}) {
  const [query, setQuery] = useState("")
  const term = useDeferredValue(query.trim())
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pdfText, setPdfText] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [searchError, setSearchError] = useState("")
  useEffect(() => {
    try {
      const value = BookmarkSchema.safeParse(
        JSON.parse(localStorage.getItem(storageKey) || "[]"),
      )
      if (value.success) setBookmarks(value.data)
    } catch {
      /* Optional local bookmarks. */
    }
    setLoaded(true)
  }, [storageKey])
  function save(value: Bookmark[]) {
    setBookmarks(value)
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* Reading remains available in private mode. */
    }
  }
  useEffect(() => {
    if (!pdf || panel !== "search" || pdfText.length || !term) return
    let disposed = false
    async function extract() {
      setBusy(true)
      try {
        const texts: string[] = []
        for (let index = 1; index <= pdf!.numPages; index++) {
          if (disposed) return
          const page = await pdf!.getPage(index)
          const content = await page.getTextContent()
          texts.push(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          )
        }
        if (!disposed) setPdfText(texts)
      } catch {
        if (!disposed)
          setSearchError("无法提取 PDF 文字；扫描版 PDF 可能没有可搜索文本。")
      } finally {
        if (!disposed) setBusy(false)
      }
    }
    void extract()
    return () => {
      disposed = true
    }
  }, [pdf, panel, pdfText.length, term])
  const matches = useMemo(() => {
    if (!term) return []
    const result: Match[] = []
    const chapters =
      book?.chapters.map((c) => ({ text: c.text, title: c.title })) ??
      pdfText.map((text, i) => ({ text, title: `第 ${i + 1} 页` }))
    for (
      let chapter = 0;
      chapter < chapters.length && result.length < 100;
      chapter++
    ) {
      const { text, title } = chapters[chapter]
      let index = text.indexOf(term)
      while (index >= 0 && result.length < 100) {
        result.push({
          chapter,
          offset: Array.from(text.slice(0, index)).length,
          title,
          fragment: "",
          excerpt: text
            .slice(Math.max(0, index - 30), index + term.length + 65)
            .trim(),
        })
        index = text.indexOf(term, index + term.length)
      }
    }
    return result
  }, [term, book, pdfText])
  const directory = book?.toc.length
    ? book.toc.filter((item) => book.chapters[item.chapter])
    : (book?.chapters.flatMap((item, chapter) =>
        item.linear
          ? [{ title: item.title, chapter, fragment: "", depth: 0 }]
          : [],
      ) ?? [])
  function open(location: Bookmark, highlight = "") {
    onNavigate(location.chapter, location.fragment, location.offset, highlight)
    onClose()
  }
  if (!panel) return null
  return (
    <aside
      className={styles.readerTools}
      aria-label={
        panel === "contents"
          ? "章节目录"
          : panel === "search"
            ? "文内搜索"
            : "书签"
      }
    >
      <div className={styles.toolHeading}>
        <h2>
          {panel === "contents"
            ? "目录"
            : panel === "search"
              ? "搜索本书"
              : "书签"}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭阅读工具"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {panel === "contents" &&
        (directory.length ? (
          directory.map((item, i) => (
            <button
              className={styles.toolEntry}
              key={i}
              style={{ paddingLeft: 12 + Math.min(item.depth, 5) * 14 }}
              aria-current={item.chapter === chapter ? "location" : undefined}
              onClick={() => open({ ...item, offset: 0 })}
            >
              {item.title || `第 ${i + 1} 节`}
            </button>
          ))
        ) : (
          <p className={styles.readerMuted}>
            这份文档没有内置目录，可使用页码跳转。
          </p>
        ))}
      {panel === "search" && (
        <>
          <Input
            autoFocus
            aria-label="搜索本书"
            placeholder="输入关键词，搜索全部章节"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p className={styles.readerMuted} role="status">
            {searchError ||
              (busy
                ? "正在提取 PDF 文字…"
                : !term
                  ? "搜索结果可直接跳到正文位置"
                  : matches.length
                    ? `找到 ${matches.length}${matches.length === 100 ? "+" : ""} 处`
                    : "没有找到相关内容")}
          </p>
          {matches.map((match, i) => (
            <button
              key={i}
              className={styles.toolEntry}
              onClick={() => open(match, term)}
            >
              <strong>{match.title}</strong>
              <span>{match.excerpt}</span>
            </button>
          ))}
        </>
      )}
      {panel === "bookmarks" && (
        <>
          <Button
            variant="outline"
            disabled={!loaded || !storageKey || bookmarks.length >= 200}
            onClick={() => {
              if (
                !bookmarks.some(
                  (mark) =>
                    mark.chapter === chapter &&
                    Math.abs(mark.offset - offset) < 60,
                )
              )
                save([
                  ...bookmarks,
                  {
                    chapter,
                    offset,
                    title:
                      book?.chapters[chapter]?.title || `第 ${chapter + 1} 页`,
                    fragment: "",
                  },
                ])
            }}
          >
            <BookmarkPlus />
            保存当前位置
          </Button>
          <p className={styles.readerMuted}>
            书签保存在当前设备，与当前账号和书籍版本关联。
          </p>
          {!bookmarks.length && (
            <p className={styles.readerMuted}>还没有书签</p>
          )}
          {bookmarks.map((mark, i) => (
            <div key={i} className={styles.bookmarkEntry}>
              <button className={styles.toolEntry} onClick={() => open(mark)}>
                {mark.title}
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`删除书签 ${mark.title}`}
                onClick={() =>
                  save(bookmarks.filter((_, index) => index !== i))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </>
      )}
    </aside>
  )
}
