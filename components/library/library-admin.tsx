"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import {
  BookOpen,
  Pencil,
  Plus,
  Trash2,
  Upload,
  ListChecks,
  Coins,
} from "lucide-react"
import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { BookCover } from "./book-cover"
import { ReadingScoreSettings } from "./reading-score-settings"
import type { BookInfo } from "./library-types"
import styles from "./library.module.css"

const EntityResult = z.object({ id: z.string() }).passthrough()
const Rule = z.object({
  id: z.string(),
  name: z.string(),
  readingMinutes: z.number(),
  enabled: z.boolean(),
  timeSlots: z.array(z.string()),
  timeoutMinutes: z.number(),
  freq: z.string(),
  startDate: z.string().nullable().optional(),
  ruleGroupId: z.string().nullable().optional(),
  scopes: z
    .array(
      z.object({ targetType: z.string(), targetId: z.string() }).passthrough(),
    )
    .optional(),
})
type ReadingRule = z.infer<typeof Rule>
const TaskCatalog = z.object({
  rules: z.array(Rule),
  users: z.array(z.object({ id: z.string(), name: z.string() })),
  groups: z.array(z.object({ id: z.string(), name: z.string() })),
})

async function multipart(url: string, method: string, data: FormData) {
  for (const key of ["file", "cover"]) {
    const value = data.get(key)
    if (value instanceof File && value.size === 0) data.delete(key)
    if (
      value instanceof File &&
      value.size > (key === "cover" ? 3 : 20) * 1024 * 1024
    )
      throw new Error(
        key === "cover" ? "封面不能超过 3 MB" : "电子书不能超过 20 MB",
      )
  }
  const response = await fetch(url, { method, body: data })
  const result = await response.json()
  if (!response.ok || !result.success)
    throw new Error(result.error?.message ?? "保存失败")
}

function BookEditor({
  book,
  onClose,
}: {
  book: BookInfo | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      await multipart(
        book ? `/api/admin/library/${book.id}` : "/api/admin/library",
        book ? "PUT" : "POST",
        new FormData(event.currentTarget),
      )
      await client.invalidateQueries({ queryKey: ["library"] })
      toast.success(book ? "图书已更新" : "电子书已上架")
      onClose()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function removeBook() {
    if (!book) return
    setBusy(true)
    try {
      await requestApi(`/api/admin/library/${book.id}`, z.unknown(), {
        method: "DELETE",
      })
      await client.invalidateQueries({ queryKey: ["library"] })
      toast.success("图书已移出书架")
      onClose()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{book ? "编辑图书" : "上传电子书"}</DialogTitle>
          <DialogDescription>
            {book
              ? "更新书籍资料、封面，或替换正文文件。"
              : "上传文件后直接上架，双端共用同一书架。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {book && (
            <div className="flex items-center gap-4">
              <BookCover book={book} className={styles.editorCover} />
              <div className="text-muted-foreground text-xs">
                {book.format} · {book.enabled ? "在架" : "已下架"}
                <p className="mt-2">封面以 2:3 比例展示</p>
              </div>
            </div>
          )}
          <label className="block space-y-2 text-sm">
            <span>书名</span>
            <Input
              name="title"
              required
              maxLength={200}
              defaultValue={book?.title ?? ""}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>作者</span>
            <Input
              name="author"
              maxLength={200}
              defaultValue={book?.author ?? ""}
              placeholder="选填"
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>{book ? "替换电子书文件（选填）" : "电子书文件"}</span>
            <Input
              name="file"
              type="file"
              accept=".pdf,.txt,.docx,.epub"
              required={!book}
              className="h-auto py-3"
            />
          </label>
          <p className={styles.caption}>
            PDF、EPUB、DOCX、UTF-8 TXT，最大 20 MB。EPUB 与 DOCX
            以正文重排阅读。
          </p>
          <label className="block space-y-2 text-sm">
            <span>{book ? "更换封面（选填）" : "封面（选填）"}</span>
            <Input
              name="cover"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="h-auto py-3"
            />
          </label>
          <p className={styles.caption}>
            PNG、JPEG、WebP，最大 3 MB。未提供封面时，EPUB 会尝试使用书内封面。
          </p>
          {book?.coverUrl && (
            <label className="flex items-center gap-2 text-sm">
              <input
                name="removeCover"
                type="checkbox"
                value="true"
                className="accent-primary size-4"
              />
              移除现有封面
            </label>
          )}
          {book && (
            <p className={styles.caption}>
            替换正文将把读者阅读位置重置到第 1 页，已有阅读时长保留。
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "正在保存…" : book ? "保存修改" : "上传并上架"}
            </Button>
          </div>
        </form>
        {book && (
          <div className="border-t pt-4">
            {remove ? (
              <div className="space-y-3">
                <p className="text-sm">
                  确定将《{book.title}
                  》移出书架？读者将无法打开这本书，已有阅读记录保留。
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={removeBook}
                  >
                    确认移出
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRemove(false)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={busy}
                onClick={() => setRemove(true)}
              >
                <Trash2 />
                移出书架
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReadingTasks() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["library-admin-tasks"],
    queryFn: () => requestApi("/api/admin/library/tasks", TaskCatalog),
  })
  const [editor, setEditor] = useState<ReadingRule | "new" | null>(null)
  const [busy, setBusy] = useState(false)
  const rule = editor && editor !== "new" ? editor : null
  const editableTime =
    !rule || (rule.freq === "DAILY" && rule.timeSlots.length === 1)
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body: Record<string, unknown> = {
      name: form.get("name"),
      readingMinutes: Number(form.get("readingMinutes")),
      timeoutMinutes: Number(form.get("timeoutMinutes")),
    }
    if (Number(body.timeoutMinutes) < Number(body.readingMinutes)) {
      toast.error("完成窗口不能少于所需阅读时长")
      return
    }
    if (editableTime) body.timeSlot = form.get("timeSlot")
    if (!rule) {
      const scope = String(form.get("target") ?? "")
      if (scope.startsWith("user:")) body.userId = scope.slice(5)
      if (scope.startsWith("group:")) body.groupId = scope.slice(6)
    }
    setBusy(true)
    try {
      await requestApi(
        rule
          ? `/api/admin/library/tasks/${rule.id}`
          : "/api/admin/library/tasks",
        EntityResult,
        { method: rule ? "PATCH" : "POST", body: JSON.stringify(body) },
      )
      await client.invalidateQueries({ queryKey: ["library-admin-tasks"] })
      toast.success(rule ? "阅读任务已更新" : "阅读任务已创建")
      setEditor(null)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function toggle(item: ReadingRule) {
    setBusy(true)
    try {
      await requestApi(`/api/admin/library/tasks/${item.id}`, EntityResult, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      })
      await client.invalidateQueries({ queryKey: ["library-admin-tasks"] })
      toast.success(item.enabled ? "阅读任务已停用" : "阅读任务已启用")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function scopeLabel(item: ReadingRule) {
    if (item.ruleGroupId)
      return (
        query.data?.groups.find((group) => group.id === item.ruleGroupId)
          ?.name ?? "任务组"
      )
    if (!item.scopes?.length) return "未分配成员"
    if (item.scopes.length > 3 && item.scopes.every((scope) => scope.targetType === "USER")) return `${item.scopes.length} 位被监管人`
    return item.scopes
      .map((scope) =>
        scope.targetType === "USER"
          ? (query.data?.users.find((user) => user.id === scope.targetId)
              ?.name ?? "指定用户")
          : "指定组织",
      )
      .join("、")
  }
  return (
    <section className="space-y-5">
      <div className={styles.shelfHeading}>
        <div>
          <h2 className="text-lg font-semibold">阅读任务</h2>
          <p className={styles.caption}>
            设置阅读分钟数，达到要求自动通过，无需提交表单。
          </p>
        </div>
        <Button onClick={() => setEditor("new")}>
          <Plus />
          新增阅读任务
        </Button>
      </div>
      {query.isPending && (
        <p role="status" className={styles.caption}>
          正在加载阅读任务…
        </p>
      )}
      {query.isError && (
        <div role="alert" className={styles.empty}>
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            重试
          </Button>
        </div>
      )}
      {query.data && !query.data.rules.length && (
        <div className={styles.empty}>
          <ListChecks className="size-8" />
          <p>还没有阅读任务</p>
          <Button variant="outline" onClick={() => setEditor("new")}>
            创建第一个任务
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {query.data?.rules.map((item) => (
          <article key={item.id} className={styles.ruleCard}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-medium">{item.name}</h3>
                <span className={styles.caption}>
                  {item.enabled ? "已启用" : "已停用"}
                </span>
              </div>
              <p className="mt-2 text-sm">
                阅读 {item.readingMinutes} 分钟自动通过
              </p>
              <p className={styles.caption}>
                {scopeLabel(item)} ·{" "}
                {item.freq === "DAILY"
                  ? "每日"
                  : item.freq === "WEEKLY"
                    ? "每周"
                    : item.freq}{" "}
                {item.timeSlots.join("、")} · 完成窗口 {item.timeoutMinutes}{" "}
                分钟
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditor(item)}
              >
                <Pencil />
                编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => toggle(item)}
              >
                {item.enabled ? "停用" : "启用"}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {editor && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEditor(null)
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {rule ? "编辑阅读任务" : "新增阅读任务"}
              </DialogTitle>
              <DialogDescription>
                {rule
                  ? "修改将应用于后续生成的任务；已生成任务保留原要求。"
                  : "按上海时间每日下发，首次从下一个开始时刻生效，阅读达标后自动通过。"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <label className="block space-y-2 text-sm">
                <span>任务名称</span>
                <Input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={rule?.name ?? "每日阅读"}
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span>所需阅读分钟数</span>
                <Input
                  name="readingMinutes"
                  type="number"
                  min={1}
                  max={1440}
                  required
                  defaultValue={rule?.readingMinutes ?? 30}
                />
              </label>
              {editableTime ? (
                <label className="block space-y-2 text-sm">
                  <span>每日开始时间</span>
                  <Input
                    name="timeSlot"
                    type="time"
                    required
                    defaultValue={rule?.timeSlots[0] ?? "19:00"}
                  />
                </label>
              ) : (
                <p className={styles.caption}>
                  保留现有频率与时段：{rule?.timeSlots.join("、")}
                  。多时段任务可在规则管理中调整时段。
                </p>
              )}
              <label className="block space-y-2 text-sm">
                <span>完成窗口（分钟）</span>
                <Input
                  name="timeoutMinutes"
                  type="number"
                  min={1}
                  max={10080}
                  required
                  defaultValue={rule?.timeoutMinutes ?? 120}
                />
              </label>
              <p className={styles.caption}>
                完成窗口必须不少于所需阅读时长。仅统计任务期间的有效阅读。
              </p>
              {!rule && (
                <label className="block space-y-2 text-sm">
                  <span>任务对象</span>
                  <select name="target" className={styles.select}>
                    <option value="">全体现有被监管人</option>
                    {query.data?.users.map((user) => (
                      <option key={user.id} value={`user:${user.id}`}>
                        {user.name}
                      </option>
                    ))}
                    {query.data?.groups.map((group) => (
                      <option key={group.id} value={`group:${group.id}`}>
                        任务组：{group.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "正在保存…" : "保存任务"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

export function LibraryAdmin({
  books,
  onRead,
}: {
  books: BookInfo[]
  onRead: (book: BookInfo) => void
}) {
  const client = useQueryClient()
  const [tab, setTab] = useState("books")
  const [editor, setEditor] = useState<BookInfo | "new" | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState("")
  async function toggle(book: BookInfo) {
    setBusy(true)
    try {
      await requestApi(`/api/admin/library/${book.id}`, EntityResult, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !book.enabled }),
      })
      await client.invalidateQueries({ queryKey: ["library"] })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const filtered = books.filter((book) =>
    `${book.title} ${book.author}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  )
  return (
    <div className="workspace-stack">
      <PageHeader
        title="图书馆管理"
        description="管理图书、阅读任务和积分规则。"
      />
      <div
        className={styles.adminTabs}
        role="tablist"
        aria-label="图书馆管理栏目"
      >
        {[
          { id: "books", name: "图书管理", icon: BookOpen },
          { id: "tasks", name: "阅读任务", icon: ListChecks },
          { id: "points", name: "阅读积分", icon: Coins },
        ].map((item) => (
          <button
            key={item.id}
            role="tab"
            id={`library-tab-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            aria-controls={`library-panel-${item.id}`}
            className={styles.adminTab}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const ids = ["books", "tasks", "points"]
              const index = ids.indexOf(item.id)
              const next =
                event.key === "ArrowRight"
                  ? ids[(index + 1) % ids.length]
                  : event.key === "ArrowLeft"
                    ? ids[(index + ids.length - 1) % ids.length]
                    : event.key === "Home"
                      ? ids[0]
                      : event.key === "End"
                        ? ids[ids.length - 1]
                        : null
              if (next) {
                event.preventDefault()
                setTab(next)
                document.getElementById(`library-tab-${next}`)?.focus()
              }
            }}
          >
            <item.icon className="size-4" />
            {item.name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`library-panel-${tab}`}
        aria-labelledby={`library-tab-${tab}`}
      >
        {tab === "books" && (
          <section className="space-y-5">
            <div className={styles.shelfHeading}>
              <div>
                <h2 className="text-lg font-semibold">
                  图书管理{" "}
                  <span className={styles.bookCount}>{books.length} 本</span>
                </h2>
                <p className={styles.caption}>
                  可编辑书名作者、更换文件与封面，管理上架状态。
                </p>
              </div>
              <Button onClick={() => setEditor("new")}>
                <Upload />
                上传电子书
              </Button>
            </div>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索书名、作者"
              aria-label="搜索管理图书"
              className="max-w-sm"
            />
            {!filtered.length && (
              <div className={styles.empty}>
                <BookOpen className="size-8" />
                <p>{books.length ? "没有找到相关图书" : "书架还没有图书"}</p>
                <Button
                  variant="outline"
                  onClick={() =>
                    books.length ? setSearch("") : setEditor("new")
                  }
                >
                  {books.length ? "清除搜索" : "上传第一本电子书"}
                </Button>
              </div>
            )}
            <div className="space-y-3">
              {filtered.map((book) => (
                <article key={book.id} className={styles.manageBook}>
                  <BookCover book={book} className={styles.manageCover} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium break-words">{book.title}</h3>
                    <p className={styles.caption}>
                      {book.author || "未署名"} · {book.format}
                    </p>
                    <span className={styles.caption}>
                      {book.enabled ? "已上架" : "已下架"}
                    </span>
                  </div>
                  <div className={styles.manageActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditor(book)}
                    >
                      <Pencil />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => toggle(book)}
                    >
                      {book.enabled ? "下架" : "上架"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!book.enabled}
                      onClick={() => onRead(book)}
                    >
                      试读
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {tab === "tasks" && <ReadingTasks />}
        {tab === "points" && (
          <div className="max-w-xl">
            <ReadingScoreSettings />
          </div>
        )}
      </div>
      {editor && (
        <BookEditor
          key={editor === "new" ? "new" : editor.id}
          book={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
