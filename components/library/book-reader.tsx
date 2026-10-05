"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { PDFDocumentProxy } from "pdfjs-dist"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  Minimize2,
  Pause,
  Play,
  Settings2,
  Minus,
  Plus,
  BookOpen,
  List,
  Search,
  Bookmark,
  X,
} from "lucide-react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HEARTBEAT_SECONDS } from "@/lib/library"
import type { BookInfo } from "./library-types"
import styles from "./library.module.css"
import { ReaderTools, type ReaderPanel } from "./reader-tools"
import {
  ReadingDocumentSchema,
  StructuredBookPage,
  type WebReadingDocument,
} from "./structured-book-page"

const Preferences = z.object({
  fontSize: z.number().min(16).max(28),
  lineHeight: z.number().min(1.6).max(2.4),
  theme: z.enum(["paper", "light", "night"]),
})
const preferenceDefaults: z.infer<typeof Preferences> = {
  fontSize: 20,
  lineHeight: 2,
  theme: "paper",
}
const preferenceKey = "custodysim.library.reader.v1"

export function BookReader({
  book,
  onClose,
}: {
  book: BookInfo
  onClose: () => void
}) {
  const client = useQueryClient()
  const reader = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const readingBody = useRef<HTMLDivElement>(null)
  const readingScroll = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [structured, setStructured] = useState<WebReadingDocument | null>(null)
  const [page, setPage] = useState(book.page)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(book.seconds)
  const [error, setError] = useState("")
  const [focused, setFocused] = useState(false)
  const [settings, setSettings] = useState(false)
  const [activeWindow, setActiveWindow] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [preferences, setPreferences] = useState(preferenceDefaults)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [pageInput, setPageInput] = useState("")
  const [acknowledgedPage, setAcknowledgedPage] = useState<number | null>(null)
  const [settlement, setSettlement] = useState("")
  const [panel, setPanel] = useState<ReaderPanel>(null)
  const [targetOffset, setTargetOffset] = useState(0)
  const [readingOffset, setReadingOffset] = useState(0)
  const [highlight, setHighlight] = useState("")
  const [pdfIdentity, setPdfIdentity] = useState("")
  const [sessionConnected, setSessionConnected] = useState(false)
  const [liveMillis, setLiveMillis] = useState(0)
  const [initialSeconds] = useState(book.seconds)
  const [navigationKey, setNavigationKey] = useState(0)
  const running =
    ready &&
    sessionConnected &&
    !paused &&
    !settings &&
    !panel &&
    activeWindow &&
    !error
  const liveSeconds = initialSeconds + Math.floor(liveMillis / 1000)
  const onPosition = useCallback((value: number) => setReadingOffset(value), [])
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      setLiveMillis((value) => value + now - last)
      last = now
    }
    const timer = window.setInterval(tick, 250)
    return () => {
      clearInterval(timer)
      tick()
    }
  }, [running])
  const sections = useMemo(
    () =>
      structured?.chapters
        .map((chapter, index) => ({ chapter, index }))
        .filter(
          ({ chapter }) =>
            chapter.linear &&
            (chapter.text.trim() || chapter.html.includes("<img")),
        ) ?? [],
    [structured],
  )
  const pages = pdf?.numPages ?? Math.max(1, sections.length)
  const safePage = Math.max(1, Math.min(page, pages))
  const reportedPage =
    structured && sections[safePage - 1]
      ? Math.floor(
          (sections[safePage - 1].chapter.start + readingOffset) / 2000,
        ) + 1
      : safePage
  const current = useRef({
    page: reportedPage,
    paused,
    settings: settings || Boolean(panel),
  })
  const [noteChapter, setNoteChapter] = useState<number | null>(null)
  const [anchor, setAnchor] = useState("")
  const navigate = useCallback(
    (chapter: number, fragment: string, offset = 0, query = "") => {
      setNavigationKey((value) => value + 1)
      if (pdf) {
        setPage(chapter + 1)
        return
      }
      setTargetOffset(offset)
      setReadingOffset(offset)
      setHighlight(query)
      const position = sections.findIndex(
        (section) => section.index === chapter,
      )
      if (position >= 0) {
        setNoteChapter(null)
        setPage(position + 1)
      }
      // Footnotes may be non-linear; expose them without losing their return link.
      else if (structured?.chapters[chapter]) setNoteChapter(chapter)
      setAnchor(fragment)
    },
    [sections, structured, pdf],
  )
  const heartbeat = useRef<(() => void) | null>(null)
  useEffect(() => {
    current.current = {
      page: reportedPage,
      paused,
      settings: settings || Boolean(panel),
    }
  }, [reportedPage, paused, settings, panel])
  useEffect(() => {
    heartbeat.current?.()
  }, [paused, settings, panel])
  useEffect(() => {
    try {
      const stored = localStorage.getItem(preferenceKey)
      if (stored) {
        const result = Preferences.safeParse(JSON.parse(stored))
        if (result.success) setPreferences(result.data)
      }
    } catch {
      /* Private mode still permits reading with defaults. */
    }
    setPreferencesLoaded(true)
  }, [])
  useEffect(() => {
    if (!preferencesLoaded) return
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences))
    } catch {
      /* Optional device preference. */
    }
  }, [preferences, preferencesLoaded])
  useEffect(() => {
    readingScroll.current?.scrollTo({ top: 0, left: 0 })
  }, [page, navigationKey])
  useEffect(() => {
    const update = () =>
      setActiveWindow(
        document.visibilityState === "visible" && document.hasFocus(),
      )
    update()
    document.addEventListener("visibilitychange", update)
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    return () => {
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
    }
  }, [])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key === "Escape") {
        setSettings(false)
        setPanel(null)
        setFocused(false)
        return
      }
      if (focused && event.key === "Tab") {
        const controls = reader.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), [tabindex='0']",
        )
        const first = controls?.[0]
        const last = controls?.[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target.closest(
          "input, textarea, select, button, [contenteditable=true]",
        )
      )
        return
      if (!ready || error || settings || panel) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        setNoteChapter(null)
        setAnchor("")
        setTargetOffset(0)
        setHighlight("")
        setPage((value) => Math.max(1, value - 1))
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        setNoteChapter(null)
        setAnchor("")
        setTargetOffset(0)
        setHighlight("")
        setPage((value) => Math.min(pages, value + 1))
      }
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [ready, pages, error, settings, focused, panel])
  useEffect(() => {
    if (!focused) return
    const previous = document.body.style.overflow
    const previousFocus = document.activeElement as HTMLElement | null
    const hidden: Array<{ element: HTMLElement; inert: boolean }> = []
    let branch: HTMLElement | null = reader.current
    while (branch?.parentElement && branch.parentElement !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          hidden.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      branch = branch.parentElement
    }
    document.body.style.overflow = "hidden"
    reader.current?.querySelector<HTMLButtonElement>("button")?.focus()
    return () => {
      document.body.style.overflow = previous
      for (const item of hidden) item.element.inert = item.inert
      previousFocus?.focus()
    }
  }, [focused])
  useEffect(() => {
    const abort = new AbortController()
    let loadedDocument: PDFDocumentProxy | undefined
    let disposed = false
    async function load() {
      try {
        const response = await fetch(
          `/api/library/${book.id}/${book.format === "PDF" ? "file" : "document"}`,
          { signal: abort.signal },
        )
        if (!response.ok) throw new Error("书籍加载失败或已下架")
        if (book.format !== "PDF") {
          const payload = await response.json()
          if (!payload.success)
            throw new Error(payload.error?.message || "无法打开阅读文档")
          const value = ReadingDocumentSchema.parse(payload.data)
          if (!disposed) {
            setStructured(value)
            const readable = value.chapters
              .map((chapter, index) => ({ chapter, index }))
              .filter(
                ({ chapter }) =>
                  chapter.linear &&
                  (chapter.text.trim() || chapter.html.includes("<img")),
              )
            const offset = (book.page - 1) * 2000
            let initial = readable.findLastIndex(
              ({ chapter }) => chapter.start <= offset,
            )
            if (book.page === 1) {
              const start = readable.findIndex(
                ({ index }) => index === value.startChapter,
              )
              if (start >= 0) initial = start
            }
            setPage(Math.max(0, initial) + 1)
            setTargetOffset(
              Math.max(
                0,
                offset - (readable[Math.max(0, initial)]?.chapter.start ?? 0),
              ),
            )
            setReady(true)
          }
        } else {
          const metadata = await fetch(
            `/api/library/${book.id}/document?metadata=1`,
            { signal: abort.signal },
          )
          if (metadata.ok) {
            const identity = await metadata.json()
            if (!disposed && identity.success)
              setPdfIdentity(
                `${identity.data.readerKey}:${identity.data.revision}`,
              )
          }
          const pdfjs = await import("pdfjs-dist")
          pdfjs.GlobalWorkerOptions.workerSrc = "/api/library/pdf-worker"
          loadedDocument = await pdfjs.getDocument({
            data: await response.arrayBuffer(),
            cMapUrl: "/api/library/pdf-assets/cmaps/",
            standardFontDataUrl: "/api/library/pdf-assets/standard_fonts/",
            wasmUrl: "/api/library/pdf-assets/wasm/",
          }).promise
          if (disposed) await loadedDocument.loadingTask.destroy()
          else {
            setPdf(loadedDocument)
            setPage((valuePage) =>
              Math.max(1, Math.min(valuePage, loadedDocument!.numPages)),
            )
          }
        }
      } catch (failure) {
        if (!disposed) setError((failure as Error).message)
      }
    }
    void load()
    return () => {
      disposed = true
      abort.abort()
      void loadedDocument?.loadingTask.destroy()
    }
  }, [book.id, book.format, book.page])
  useEffect(() => {
    if (!pdf || !canvas.current) return
    let cancelled = false
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined
    void pdf
      .getPage(Math.min(page, pdf.numPages))
      .then((pdfPage) => {
        if (cancelled || !canvas.current) return
        const viewport = pdfPage.getViewport({ scale: (1.5 * zoom) / 100 })
        canvas.current.width = viewport.width
        canvas.current.height = viewport.height
        task = pdfPage.render({ canvas: canvas.current, viewport })
        return task.promise.then(() => {
          if (!cancelled) setReady(true)
        })
      })
      .catch((failure: Error) => {
        if (!cancelled) {
          setError(failure.message)
          setPaused(true)
        }
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, page, zoom])
  useEffect(() => {
    if (!ready) return
    let sessionId: string | undefined
    let disposed = false
    let queue = Promise.resolve()
    function tick(close = false) {
      const state = current.current
      const active =
        !close &&
        !state.paused &&
        !state.settings &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      queue = queue.then(async () => {
        if (!sessionId) return
        try {
          const result = await requestApi(
            "/api/library/reading",
            z.object({
              creditedSeconds: z.number(),
              awardedPoints: z.number().optional(),
              approvedTasks: z.number().optional(),
            }),
            {
              method: "PATCH",
              keepalive: close,
              body: JSON.stringify({
                sessionId,
                active,
                close,
                page: state.page,
              }),
            },
          )
          if (!disposed) {
            setSeconds((value) => value + result.creditedSeconds)
            setAcknowledgedPage(state.page)
            setSessionConnected(!close)
            const messages: string[] = []
            if (result.approvedTasks) messages.push("学习任务已自动通过")
            if (result.awardedPoints)
              messages.push(`阅读积分 +${result.awardedPoints}`)
            if (messages.length) {
              setSettlement(messages.join(" · "))
              void client.invalidateQueries({ queryKey: ["library"] })
              void client.invalidateQueries({ queryKey: ["tasks"] })
            }
          }
        } catch (failure) {
          if (!disposed) {
            setError(`计时保存失败：${(failure as Error).message}`)
            setPaused(true)
            setSessionConnected(false)
          }
          sessionId = undefined
        }
      })
    }
    void requestApi(
      "/api/library/reading",
      z.object({ sessionId: z.string() }),
      {
        method: "POST",
        body: JSON.stringify({ bookId: book.id }),
      },
    )
      .then((result) => {
        sessionId = result.sessionId
        tick(disposed)
      })
      .catch((failure: Error) => {
        if (!disposed) setError(failure.message)
      })
    const change = () => tick()
    const exit = () => tick(true)
    document.addEventListener("visibilitychange", change)
    window.addEventListener("focus", change)
    window.addEventListener("blur", change)
    window.addEventListener("pagehide", exit)
    const timer = window.setInterval(change, HEARTBEAT_SECONDS * 1000)
    heartbeat.current = change
    return () => {
      disposed = true
      clearInterval(timer)
      heartbeat.current = null
      document.removeEventListener("visibilitychange", change)
      window.removeEventListener("focus", change)
      window.removeEventListener("blur", change)
      window.removeEventListener("pagehide", exit)
      tick(true)
    }
  }, [ready, book.id, client])
  function jump(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(pageInput)
    if (Number.isInteger(value) && value >= 1 && value <= pages) {
      setNoteChapter(null)
      setAnchor("")
      setTargetOffset(0)
      setHighlight("")
      setPage(value)
      setPageInput("")
    }
  }
  const previousLabel = structured ? "上一节" : "上一页"
  const nextLabel = structured ? "下一节" : "下一页"
  return (
    <section
      ref={reader}
      role={focused ? "dialog" : undefined}
      aria-modal={focused ? true : undefined}
      aria-label={`${book.title}阅读器`}
      className={`${styles.reader} ${focused ? styles.focused : ""}`}
      data-theme={preferences.theme}
    >
      <header className={styles.readerHeader}>
        <Button
          variant="ghost"
          onClick={onClose}
          className={styles.readerButton}
        >
          <ArrowLeft />
          <span className="hidden sm:inline">书架</span>
          <span className="sr-only sm:hidden">返回书架</span>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{book.title}</h1>
          <p className={styles.readerMuted}>
            {book.author || "未署名"} · {book.format}
          </p>
        </div>
        <span
          className={styles.timer}
          title={`有效阅读时长实时显示，切换窗口时暂停；服务端已记录 ${Math.floor(seconds / 60)} 分钟 ${seconds % 60} 秒`}
          aria-label={`${running ? "阅读中" : paused || settings ? "已暂停" : "等待阅读"}，本书累计${Math.floor(liveSeconds / 60)}分钟${liveSeconds % 60}秒`}
        >
          <span className={running ? styles.activeDot : styles.idleDot} />
          {Math.floor(liveSeconds / 60)}:
          {String(liveSeconds % 60).padStart(2, "0")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={styles.readerButton}
          disabled={!ready || Boolean(error)}
          aria-label={paused ? "继续计时" : "暂停计时"}
          title={paused ? "继续计时" : "暂停计时"}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        {(
          [
            ["contents", "目录", List],
            ["search", "搜索", Search],
            ["bookmarks", "书签", Bookmark],
          ] as const
        ).map(([value, label, Icon]) => (
          <Button
            key={value}
            variant="ghost"
            size="icon"
            className={styles.readerButton}
            aria-label={label}
            title={label}
            disabled={!ready}
            aria-expanded={panel === value}
            onClick={() => {
              setSettings(false)
              setPanel(panel === value ? null : value)
            }}
          >
            <Icon />
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className={styles.readerButton}
          aria-label="阅读设置"
          title="阅读设置"
          aria-expanded={settings}
          aria-controls="reader-preferences"
          onClick={() => {
            setPanel(null)
            setSettings(!settings)
          }}
        >
          <Settings2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={styles.readerButton}
          aria-label={focused ? "退出专注模式" : "进入专注模式"}
          title={focused ? "退出专注模式（Esc）" : "专注阅读"}
          aria-pressed={focused}
          onClick={() => setFocused(!focused)}
        >
          {focused ? <Minimize2 /> : <Expand />}
        </Button>
      </header>
      {settings && (
        <aside
          id="reader-preferences"
          aria-label="阅读设置"
          className={styles.readerTools}
        >
          <div className={styles.toolHeading}>
            <h2>阅读设置</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭阅读设置"
              onClick={() => setSettings(false)}
            >
              <X />
            </Button>
          </div>
          {book.format !== "PDF" ? (
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>
                  字号{" "}
                  <span className="tabular-nums">{preferences.fontSize}</span>
                </span>
                <input
                  aria-label="正文字号"
                  className="accent-primary block w-full"
                  type="range"
                  min={16}
                  max={28}
                  step={1}
                  value={preferences.fontSize}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      fontSize: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>
                  行距{" "}
                  <span className="tabular-nums">
                    {preferences.lineHeight.toFixed(1)}
                  </span>
                </span>
                <input
                  aria-label="正文行距"
                  className="accent-primary block w-full"
                  type="range"
                  min={1.6}
                  max={2.4}
                  step={0.1}
                  value={preferences.lineHeight}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      lineHeight: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <p className={styles.readerMuted}>
              PDF 保留原版排版，可在下方调整缩放。
            </p>
          )}
          <fieldset>
            <legend className="mb-2 text-sm">阅读背景</legend>
            <div className="flex gap-2">
              {(
                [
                  ["paper", "暖纸"],
                  ["light", "明亮"],
                  ["night", "夜间"],
                ] as const
              ).map(([theme, label]) => (
                <button
                  key={theme}
                  type="button"
                  className={styles.themeOption}
                  aria-pressed={preferences.theme === theme}
                  onClick={() => setPreferences({ ...preferences, theme })}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className={styles.readerMuted}>
            偏好保存在当前设备。左右方向键翻页，Esc 退出专注模式。
          </p>
        </aside>
      )}
      <ReaderTools
        key={
          structured
            ? `${structured.readerKey}:${structured.revision}`
            : pdfIdentity
        }
        panel={panel}
        onClose={() => setPanel(null)}
        document={structured}
        pdf={pdf}
        storageKey={
          structured
            ? `library-bookmarks:${structured.readerKey}:${structured.revision}`
            : pdfIdentity
              ? `library-bookmarks:${pdfIdentity}`
              : ""
        }
        chapter={noteChapter ?? sections[safePage - 1]?.index ?? safePage - 1}
        offset={readingOffset}
        onNavigate={navigate}
      />
      <div
        ref={readingScroll}
        data-reader-scroll
        className={styles.readingScroll}
      >
        {error && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 mx-auto my-6 max-w-2xl rounded-xl border p-4 text-sm"
          >
            <p>{error}</p>
            <p className="mt-1 opacity-75">
              计时已停止。返回书架重新打开后继续。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onClose}
            >
              返回书架
            </Button>
          </div>
        )}
        {!ready && !error && (
          <div className={styles.readerLoading} role="status">
            <BookOpen className="size-8 opacity-50" />
            <span>正在打开电子书…</span>
            <span className={styles.readerMuted}>接着上次的位置阅读</span>
          </div>
        )}
        <div
          ref={readingBody}
          className={book.format === "PDF" ? styles.pdfPaper : styles.textPaper}
        >
          {book.format === "PDF" ? (
            <canvas
              ref={canvas}
              style={{ width: `${zoom}%`, maxWidth: "none" }}
              className="h-auto"
              aria-label={`PDF第 ${safePage} 页，共 ${pages} 页`}
              role="img"
            />
          ) : (
            ready && (
              <>
                <div className={styles.paperMeta}>
                  <span>
                    {sections[safePage - 1]?.chapter.title || book.title}
                  </span>
                  <span>{String(safePage).padStart(2, "0")}</span>
                </div>
                {structured && sections[safePage - 1] && (
                  <>
                    {noteChapter !== null && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setNoteChapter(null)
                          setAnchor("")
                          setTargetOffset(0)
                          setHighlight("")
                        }}
                      >
                        返回正文
                      </Button>
                    )}
                    <StructuredBookPage
                      document={structured}
                      chapter={noteChapter ?? sections[safePage - 1].index}
                      fontSize={preferences.fontSize}
                      lineHeight={preferences.lineHeight}
                      night={preferences.theme === "night"}
                      onNavigate={navigate}
                      fragment={anchor}
                      offset={targetOffset}
                      highlight={highlight}
                      onPosition={onPosition}
                      navigationKey={navigationKey}
                    />
                  </>
                )}
                <div className={styles.paperEnd}>· {safePage} ·</div>
              </>
            )
          )}
        </div>
      </div>
      <footer className={styles.readerFooter}>
        {book.format === "PDF" && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className={styles.readerButton}
              disabled={zoom <= 75}
              aria-label="缩小PDF"
              onClick={() => setZoom((value) => Math.max(75, value - 25))}
            >
              <Minus />
            </Button>
            <span className="w-10 text-center text-xs tabular-nums">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className={styles.readerButton}
              disabled={zoom >= 200}
              aria-label="放大PDF"
              onClick={() => setZoom((value) => Math.min(200, value + 25))}
            >
              <Plus />
            </Button>
          </div>
        )}
        {structured && sections[safePage - 1] && (
          <select
            aria-label="章节目录"
            className="max-w-48 truncate rounded-md border bg-transparent px-2 py-1 text-xs"
            value={sections[safePage - 1].index}
            onChange={(event) => navigate(Number(event.target.value), "")}
          >
            {sections.map(({ chapter, index }) => (
              <option key={index} value={index}>
                {chapter.title || `第 ${index + 1} 节`}
              </option>
            ))}
          </select>
        )}
        <nav aria-label="阅读翻页" className={styles.pagination}>
          <Button
            variant="ghost"
            className={styles.readerButton}
            disabled={!ready || safePage <= 1}
            aria-label={previousLabel}
            onClick={() => {
              setNoteChapter(null)
              setAnchor("")
              setTargetOffset(0)
              setHighlight("")
              setPage(safePage - 1)
            }}
          >
            <ChevronLeft />
            <span className="hidden sm:inline">{previousLabel}</span>
          </Button>
          <form onSubmit={jump} className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="reader-page">
              {structured ? "跳转章节" : "跳转页码"}
            </label>
            <Input
              id="reader-page"
              type="number"
              min={1}
              max={pages}
              className={styles.pageInput}
              placeholder={String(safePage)}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              disabled={!ready}
            />
            <span className="text-xs opacity-60">/ {pages}</span>
            <button
              type="submit"
              className={styles.jumpButton}
              disabled={!pageInput || !ready}
            >
              跳转
            </button>
          </form>
          <Button
            variant="ghost"
            className={styles.readerButton}
            disabled={!ready || safePage >= pages}
            aria-label={nextLabel}
            onClick={() => {
              setNoteChapter(null)
              setAnchor("")
              setTargetOffset(0)
              setHighlight("")
              setPage(safePage + 1)
            }}
          >
            <span className="hidden sm:inline">{nextLabel}</span>
            <ChevronRight />
          </Button>
        </nav>
        <span className={styles.saveHint} role="status">
          {error
            ? "保存中断"
            : paused
              ? "已暂停计时"
              : settings || panel
                ? "阅读工具 · 已暂停计时"
                : !activeWindow
                  ? "离开窗口 · 已暂停"
                  : settlement ||
                    (acknowledgedPage === reportedPage
                      ? "阅读进度已同步"
                      : "等待同步阅读进度")}
        </span>
      </footer>
    </section>
  )
}
