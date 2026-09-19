"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { BellRing, Megaphone, Send, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { LoadingBlock } from "@/components/shared/query-state-view"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { NOTICE_RETENTION_DAYS } from "@/lib/constants"

const NoticeSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  targetRole: z.string(),
  priority: z.string(),
  published: z.boolean().optional(),
  publishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable().optional(),
})
const NoticesSchema = z.array(NoticeSchema)

/** 两个列表接口都用仓库既定的游标分页契约：{ items, nextCursor }。 */
const NoticePageSchema = z.object({
  items: NoticesSchema,
  nextCursor: z.string().nullable(),
})

const audienceText: Record<string, string> = { ALL: "全体人员", SUPERVISED: "在押人员", SUPERVISOR: "监管员", ADMIN: "管理处" }
const priorityText: Record<string, string> = { NORMAL: "普通", IMPORTANT: "重要", URGENT: "紧急" }

const AUDIENCE_PAGE_SIZE = 20
const ADMIN_PAGE_SIZE = 10

export function NoticesWorkspace({ title = "监所公示" }: { title?: string }) {
  const client = useQueryClient()
  const notices = useInfiniteQuery({
    queryKey: ["notices"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestApi(
        pageParam
          ? `/api/notices?limit=${AUDIENCE_PAGE_SIZE}&cursor=${encodeURIComponent(pageParam)}`
          : `/api/notices?limit=${AUDIENCE_PAGE_SIZE}`,
        NoticePageSchema,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
  const read = useMutation({
    mutationFn: (noticeId: string) =>
      requestApi("/api/notices", z.object({ id: z.string() }), {
        method: "PATCH",
        body: JSON.stringify({ noticeId }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notices"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
    },
  })

  const items = notices.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监所公示"
        title={title}
        description="查阅监所下达的正式通知。阅读后请确认已阅，并留意通知中的执行时间与要求。"
      />
      {notices.isLoading ? <LoadingBlock rows={3} /> : null}
      {items.map((notice) => (
        <Card
          key={notice.id}
          className={notice.readAt ? "" : "border-brand-500/40"}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="size-4" />
                {notice.title}
              </CardTitle>
              <span className="text-muted-foreground text-xs">
                {priorityText[notice.priority] ?? notice.priority}
                {notice.readAt ? " · 已读" : " · 未读"}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 whitespace-pre-wrap">
              {notice.content}
            </p>
            <div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span>发布时间：{formatDate(notice.publishedAt ?? notice.createdAt)}</span>
              {!notice.readAt ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={read.isPending}
                  onClick={() => read.mutate(notice.id)}
                >
                  确认已阅
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
      {notices.data && items.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="暂无通知"
          description="当前暂无已发布的监所通知。"
        />
      ) : null}
      {notices.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={notices.isFetchingNextPage}
            onClick={() => notices.fetchNextPage()}
          >
            {notices.isFetchingNextPage ? "加载中…" : "加载更早的公示"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function NoticeManage() {
  const client = useQueryClient()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [targetRole, setTargetRole] = useState("ALL")
  const [priority, setPriority] = useState("NORMAL")
  const [expiresAt, setExpiresAt] = useState("")
  const publish = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/notices", NoticeSchema, {
        method: "POST",
        body: JSON.stringify({
          title,
          content,
          targetRole,
          priority,
          published: true,
          // 保留期由后端字段控制：选定日期按上海时区当日 23:59:59 到期
          expiresAt: expiresAt
            ? new Date(`${expiresAt}T23:59:59+08:00`).toISOString()
            : null,
        }),
      }),
    onSuccess: () => {
      setTitle("")
      setContent("")
      setExpiresAt("")
      client.invalidateQueries({ queryKey: ["admin-notices"] })
      client.invalidateQueries({ queryKey: ["notices"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
      toast.success("通知已发布")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "发布失败"),
  })

  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="系统管理"
        title="监所通知"
        description="向监管员或在押人员下达正式通知，写明执行要求与时间；监所标语在「标语与文案」中维护。"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4" />
            发布通知
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>通知标题</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>发送对象</Label>
            <Select value={targetRole} onValueChange={setTargetRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全体人员</SelectItem>
                <SelectItem value="SUPERVISED">在押人员</SelectItem>
                <SelectItem value="SUPERVISOR">监管员</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>优先级</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">普通</SelectItem>
                <SelectItem value="IMPORTANT">重要</SelectItem>
                <SelectItem value="URGENT">紧急</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>有效期至（可选）</Label>
            <div className="max-w-xs">
              <DatePicker
                ariaLabel="通知有效期"
                value={expiresAt}
                onValueChange={setExpiresAt}
                minDate={new Date()}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              留空表示长期有效；到期后该通知不再出现在受众的公示列表与未读统计中，
              记录本身仍会保留到保留期结束。
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>通知内容</Label>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-32"
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={publish.isPending || !title.trim() || !content.trim()}
              onClick={() => publish.mutate()}
            >
              <Send />
              发布通知
            </Button>
          </div>
        </CardContent>
      </Card>

      <NoticeRecords />
    </div>
  )
}

/**
 * 发布记录。
 * 通知此前没有保留期也没有删除入口，会无限堆积，因此这里补齐三件事：
 * 1) 服务端分页 + 服务端关键词搜索（正文是 text，不能全量回传）；
 * 2) 下架 / 恢复发布（下架后受众不可见，但记录保留供追溯）；
 * 3) 物理删除（notice_reads 级联清除），配合保留期自动清理。
 */
function NoticeRecords() {
  const client = useQueryClient()
  const [keyword, setKeyword] = useState("")
  const [appliedKeyword, setAppliedKeyword] = useState("")

  // 输入防抖：停顿 300ms 才发起服务端搜索，避免逐字符打请求
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedKeyword(keyword.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keyword])

  const notices = useInfiniteQuery({
    // 关键词变化即重建查询，分页自然回到第一页
    queryKey: ["admin-notices", appliedKeyword],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestApi(
        `/api/admin/notices?limit=${ADMIN_PAGE_SIZE}${
          appliedKeyword ? `&keyword=${encodeURIComponent(appliedKeyword)}` : ""
        }${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        NoticePageSchema,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const setPublished = useMutation({
    mutationFn: ({
      id,
      published,
    }: {
      id: string
      published: boolean
    }) =>
      requestApi(`/api/admin/notices/${id}`, NoticeSchema, {
        method: "PATCH",
        body: JSON.stringify({ published }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-notices"] })
      client.invalidateQueries({ queryKey: ["notices"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
      toast.success("通知状态已更新")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "操作失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/notices/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-notices"] })
      client.invalidateQueries({ queryKey: ["notices"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
      toast.success("通知已删除")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "删除失败"),
  })

  const items = notices.data?.pages.flatMap((page) => page.items) ?? []
  const busy = setPublished.isPending || remove.isPending

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-lg font-semibold">发布记录</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            通知保留 {NOTICE_RETENTION_DAYS} 天（约 3 个月），到期由系统自动清理
            （草稿按最后更新时间计算）；按创建时间倒序，每次 {ADMIN_PAGE_SIZE} 条。
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Input
            value={keyword}
            aria-label="搜索发布记录"
            placeholder="搜索标题或内容"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
      </div>

      {notices.isLoading ? <LoadingBlock rows={3} /> : null}

      {items.map((notice) => (
        <Card key={notice.id}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold">{notice.title}</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  tone={notice.published === false ? "neutral" : "success"}
                >
                  {notice.published === false ? "已下架" : "已发布"}
                </StatusPill>
                <span className="text-muted-foreground text-xs">
                  {audienceText[notice.targetRole] ?? "指定人员"} ·{" "}
                  {priorityText[notice.priority] ?? notice.priority} ·{" "}
                  {formatDate(notice.createdAt)} ·{" "}
                  {notice.expiresAt
                    ? `有效期至 ${formatDate(notice.expiresAt)}`
                    : "长期有效"}
                </span>
              </div>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-6 whitespace-pre-wrap">
              {notice.content}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setPublished.mutate({
                    id: notice.id,
                    published: notice.published === false,
                  })
                }
              >
                {notice.published === false ? "恢复发布" : "下架"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `确定删除“${notice.title}”吗？\n\n删除后不可恢复，该通知及其已读记录会一并清除。\n如果只是想让它对受众不可见、同时保留记录，请改用「下架」。`,
                    )
                  )
                    remove.mutate(notice.id)
                }}
              >
                <Trash2 className="size-3.5" />
                删除
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {notices.data && items.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title={appliedKeyword ? "没有匹配的通知" : "暂无发布记录"}
          description={
            appliedKeyword
              ? "换一个关键词再试，或清空搜索框查看全部记录。"
              : "发布第一条通知后，这里会按创建时间倒序列出记录。"
          }
        />
      ) : null}

      {notices.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={notices.isFetchingNextPage}
            onClick={() => notices.fetchNextPage()}
          >
            {notices.isFetchingNextPage ? "加载中…" : "加载更早的记录"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
