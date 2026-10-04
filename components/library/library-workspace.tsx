"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  Search,
  Library,
  RefreshCw,
} from "lucide-react"
import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BookReader } from "./book-reader"
import { BookCover } from "./book-cover"
import { LibraryAdmin } from "./library-admin"
import { CatalogSchema, type BookInfo } from "./library-types"
import styles from "./library.module.css"

const formats = ["全部", "EPUB", "PDF", "DOCX", "TXT"] as const
export function LibraryWorkspace({ admin = false }: { admin?: boolean }) {
  const client = useQueryClient()
  const catalog = useQuery({
    queryKey: ["library"],
    queryFn: () => requestApi("/api/library", CatalogSchema),
  })
  const [selected, setSelected] = useState<BookInfo | null>(null)
  const [search, setSearch] = useState("")
  const [format, setFormat] = useState<(typeof formats)[number]>("全部")
  const data = catalog.data
  if (selected)
    return (
      <BookReader
        key={selected.id}
        book={selected}
        onClose={() => {
          setSelected(null)
          void client.invalidateQueries({ queryKey: ["library"] })
          void client.invalidateQueries({ queryKey: ["tasks"] })
        }}
      />
    )
  if (catalog.isError)
    return (
      <div className={styles.empty} role="alert">
        <p>图书馆暂时无法加载</p>
        <span className={styles.caption}>{catalog.error.message}</span>
        <Button variant="outline" onClick={() => catalog.refetch()}>
          重新加载
        </Button>
      </div>
    )
  if (!data)
    return (
      <div className={styles.empty} role="status">
        <RefreshCw className="size-7" />
        <p>正在整理书架…</p>
      </div>
    )
  if (admin || data.actorRole === "ADMIN")
    return <LibraryAdmin books={data.books} onRead={setSelected} />
  const needle = search.trim().toLocaleLowerCase()
  const books = data.books.filter(
    (book) =>
      (format === "全部" || book.format === format) &&
      `${book.title} ${book.author}`.toLocaleLowerCase().includes(needle),
  )
  const recent = data.books
    .filter((book) => book.enabled && (book.seconds > 0 || book.updatedAt))
    .sort(
      (a, b) =>
        (b.updatedAt ? Date.parse(b.updatedAt) : 0) -
        (a.updatedAt ? Date.parse(a.updatedAt) : 0),
    )[0]
  const task = data.readingTasks?.find((item) => item.status !== "APPROVED")
  const policy = data.scorePolicy
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="LIBRARY"
        title="图书馆"
        description="留一点时间给阅读，接着上次的位置继续。"
        action={
          <span className={styles.headerNote}>
            <BookOpen className="size-4" />
            阅读进度自动保存
          </span>
        }
      />
      <div className={styles.overview}>
        <section
          className={`${styles.continuePanel} ${recent ? styles.continueWithCover : ""}`}
        >
          {recent && (
            <BookCover book={recent} className={styles.continueCover} />
          )}
          <div className="min-w-0">
            <div className={styles.sectionLabel}>
              <BookOpen className="size-4" />
              {recent ? "继续阅读" : "从一本书开始"}
            </div>
            <h2 className={styles.continueTitle}>
              {recent?.title ?? "给自己一段安静的时间"}
            </h2>
            <p className={styles.caption}>
              {recent
                ? `${recent.author || "未署名"} · ${recent.format} · 上次读到第 ${recent.page} 页`
                : "挑一本感兴趣的书。离开时，位置和有效阅读时长会自动保存。"}
            </p>
            {recent ? (
              <Button className="mt-5" onClick={() => setSelected(recent)}>
                接着读
                <ArrowRight />
              </Button>
            ) : (
              <Button
                className="mt-5"
                variant="outline"
                onClick={() =>
                  document
                    .getElementById("library-shelf")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                浏览书架
                <ArrowRight />
              </Button>
            )}
          </div>
        </section>
        <section className={styles.todayPanel} aria-label="今日阅读">
          <div className={styles.sectionLabel}>
            <Clock3 className="size-4" />
            今日阅读
          </div>
          <div className={styles.todayNumber}>
            {Math.floor((data.todaySeconds ?? 0) / 60)}
            <span>分钟</span>
          </div>
          {policy?.enabled && (
            <>
              <div className={styles.scoreLine}>
                <span>阅读积分</span>
                <span className="tabular-nums">
                  {data.todayPoints ?? 0} / {policy.dailyCap} 分
                </span>
              </div>
              <div className={styles.scoreTrack} aria-hidden="true">
                <div
                  style={{
                    width: `${Math.min(100, ((data.todayPoints ?? 0) / Math.max(1, policy.dailyCap)) * 100)}%`,
                  }}
                />
              </div>
            </>
          )}
          <p className={styles.caption}>
            {policy?.enabled
              ? `每 ${policy.minutesPerPoint} 分钟 +1 分，每日最多 ${policy.dailyCap} 分`
              : "阅读时长自动累计"}
          </p>
          <p className={styles.caption}>
            累计阅读 {Math.floor(data.totalSeconds / 60)} 分钟
          </p>
        </section>
      </div>
      {task && (
        <section className={styles.taskPanel} aria-label="学习任务阅读进度">
          <div className="flex min-w-0 items-center gap-3">
            <div className={styles.taskIcon}>
              <Check className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{task.title}</h2>
              <p className={styles.caption}>
                阅读满 {task.readingMinutes} 分钟自动通过
              </p>
            </div>
          </div>
          <span className="shrink-0 text-sm tabular-nums">
            {Math.floor(task.readingSeconds / 60)} / {task.readingMinutes} 分钟
          </span>
          <progress
            className={styles.taskProgress}
            aria-label={`${task.title}阅读完成进度`}
            value={Math.min(task.readingSeconds, task.readingMinutes * 60)}
            max={Math.max(1, task.readingMinutes * 60)}
          />
        </section>
      )}
      <section id="library-shelf" className={styles.shelf}>
        <div className={styles.shelfHeading}>
          <h2 className="text-lg font-semibold">
            全部图书
            <span className={styles.bookCount}>{data.books.length}</span>
          </h2>
          <div className={styles.search}>
            <Search className="size-4" />
            <Input
              aria-label="搜索书名或作者"
              placeholder="搜索书名、作者"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <div
          className={styles.filters}
          role="group"
          aria-label="按文件格式筛选"
        >
          {formats.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={format === item}
              className={styles.filter}
              onClick={() => setFormat(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {!books.length && (
          <div className={styles.empty}>
            <Library className="size-8" />
            <h3 className="font-medium">
              {data.books.length ? "没有找到这本书" : "书架还没有图书"}
            </h3>
            <p className={styles.caption}>
              {data.books.length
                ? "试试其他书名、作者或文件格式。"
                : "管理员上架图书后，就可以在这里阅读。"}
            </p>
            {data.books.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("")
                  setFormat("全部")
                }}
              >
                清除筛选
              </Button>
            )}
          </div>
        )}
        <div className={styles.coverGrid}>
          {books.map((book) => (
            <article key={book.id} className={styles.coverBook}>
              <button
                type="button"
                className={styles.coverOpen}
                onClick={() => setSelected(book)}
                disabled={!book.enabled}
                aria-label={`打开${book.title}`}
              >
                <BookCover book={book} />
                <span className={styles.coverFormat}>{book.format}</span>
              </button>
              <h3 className={styles.coverTitle}>{book.title}</h3>
              <p className={styles.bookAuthor}>{book.author || "未署名"}</p>
              <p className={styles.caption}>
                {book.seconds > 0 || book.updatedAt
                  ? `第 ${book.page} 页 · 已读 ${Math.floor(book.seconds / 60)} 分钟`
                  : "尚未开始阅读"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 justify-start px-0"
                disabled={!book.enabled}
                onClick={() => setSelected(book)}
              >
                {book.seconds > 0 || book.updatedAt ? "继续阅读" : "开始阅读"}
                <ArrowRight />
              </Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
