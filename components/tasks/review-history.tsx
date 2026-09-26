"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { History } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { LoadingBlock } from "@/components/shared/query-state-view"
import { TaskSubmissionContent } from "@/components/tasks/task-submission-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const DatePicker = dynamic(
  () =>
    import("@/components/ui/date-picker").then((module) => module.DatePicker),
  { loading: () => <span role="status">正在加载日期筛选…</span> },
)

/**
 * 审核时冻结的提交快照（A5 起写入）。
 *
 * 老记录没有快照，接口会用当前提交内容兜底并置 `snapshotMissing` —— 这里如实提示，
 * 不让人误以为看到的是"当时原文"。
 */
const SubmittedSnapshot = z
  .object({
    data: z.unknown().optional(),
    content: z.string().nullable().optional(),
    templateSnapshot: z.unknown().optional(),
    submissionUpdatedAt: z.string().nullable().optional(),
  })
  .nullable()

const ReviewRecord = z.object({
  id: z.string(),
  result: z.string(),
  grade: z.number().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  reviewerName: z.string().nullable(),
  automated: z.boolean(),
  taskId: z.string(),
  taskTitle: z.string(),
  supervisedName: z.string().nullable(),
  submittedSnapshot: SubmittedSnapshot.optional(),
  snapshotMissing: z.boolean().optional(),
})

const ReviewPage = z.object({
  items: z.array(ReviewRecord),
  nextCursor: z.string().nullable(),
})

const PAGE_SIZE = 30

/** 快照里的模板字段：直接复用 `TaskSubmissionContent` 的参数类型，避免两处定义漂移。 */
type SnapshotFields = Parameters<typeof TaskSubmissionContent>[0]["fields"]

function snapshotFields(snapshot: unknown): SnapshotFields {
  if (typeof snapshot !== "object" || snapshot === null) return []
  const fields = (snapshot as { fields?: unknown }).fields
  return Array.isArray(fields) ? (fields as SnapshotFields) : []
}

function snapshotData(snapshot: unknown): Record<string, unknown> | null {
  if (typeof snapshot !== "object" || snapshot === null) return null
  const data = (snapshot as { data?: unknown }).data
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null
}

/** `YYYY-MM-DD`（本地时区）当天 00:00 对应的 ISO 瞬间；`to` 传次日 00:00（接口是开区间）。 */
function localDayStartIso(dateKey: string, addDays = 0) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(year, month - 1, day + addDays).toISOString()
}

/**
 * 批阅记录（历史）。
 * 可见范围由接口按角色裁决：管理员全部、监管员为监管范围内、被监管人仅本人。
 */
export function ReviewHistory() {
  // 筛选：批阅人（AI / 人工）与时间范围。它们参与 queryKey，任一变化即重新取第一页。
  const [automated, setAutomated] = useState("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  /** 展开查看「当次提交内容」的记录 id。 */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const reviews = useInfiniteQuery({
    queryKey: ["review-history", automated, fromDate, toDate],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      // cursor 形如 `createdAt|id`，交给 URLSearchParams 编码（`|` 必须转义）。
      if (pageParam) params.set("cursor", pageParam)
      if (automated === "ai") params.set("automated", "1")
      if (automated === "manual") params.set("automated", "0")
      if (fromDate) params.set("from", localDayStartIso(fromDate))
      if (toDate) params.set("to", localDayStartIso(toDate, 1))
      return requestApi(`/api/reviews?${params.toString()}`, ReviewPage)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const records = reviews.data?.pages.flatMap((page) => page.items) ?? []
  const filtersActive = automated !== "all" || Boolean(fromDate || toDate)

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="任务批阅 · 记录"
        title="批阅记录"
        description={`按时间倒序查看已完成的批阅结果、评分与意见，每次 ${PAGE_SIZE} 条。`}
      />
      {/* 筛选器：与游标分页共存，切换即回到第一页（queryKey 变化）。 */}
      <div className="flex flex-wrap items-end gap-3 px-1">
        <div className="w-full sm:w-44">
          <Label>批阅人</Label>
          <div className="mt-2">
            <Select value={automated} onValueChange={setAutomated}>
              <SelectTrigger aria-label="批阅人筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="ai">AI 系统</SelectItem>
                <SelectItem value="manual">人工批阅</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="w-full sm:w-44">
          <Label>起始日期</Label>
          <div className="mt-2">
            <DatePicker
              ariaLabel="批阅起始日期"
              value={fromDate}
              onValueChange={(value) => setFromDate(value ?? "")}
            />
          </div>
        </div>
        <div className="w-full sm:w-44">
          <Label>结束日期</Label>
          <div className="mt-2">
            <DatePicker
              ariaLabel="批阅结束日期"
              value={toDate}
              onValueChange={(value) => setToDate(value ?? "")}
            />
          </div>
        </div>
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAutomated("all")
              setFromDate("")
              setToDate("")
            }}
          >
            清除筛选
          </Button>
        ) : null}
      </div>
      <Card>
        <CardContent className="p-5 sm:p-7">
          {reviews.isLoading ? (
            <LoadingBlock rows={5} />
          ) : records.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              暂无批阅记录
            </p>
          ) : (
            <div className="divide-border/60 divide-y">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="flex gap-3.5 py-4 first:pt-0 last:pb-0"
                >
                  <span className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
                    <History className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-foreground font-medium">
                        {record.taskTitle}
                      </p>
                      <Badge
                        variant={
                          record.result === "APPROVED" ? "success" : "warning"
                        }
                      >
                        {record.result === "APPROVED" ? "通过" : "退回"}
                      </Badge>
                      {typeof record.grade === "number" ? (
                        <Badge variant="brand">评分 {record.grade}</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {record.supervisedName ?? "在押人员"} · 批阅人：
                      {record.automated
                        ? "AI 系统"
                        : (record.reviewerName ?? "未知")}{" "}
                      · {formatDate(record.createdAt)}
                    </p>
                    {record.comment?.trim() ? (
                      <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                        {record.comment}
                      </p>
                    ) : null}
                    {/* 历史批阅要能看到「当时审的是什么」：默认收起，点开才渲染答案与图片。 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 mt-2"
                      aria-expanded={expandedId === record.id}
                      onClick={() =>
                        setExpandedId(
                          expandedId === record.id ? null : record.id,
                        )
                      }
                    >
                      {expandedId === record.id
                        ? "收起提交内容"
                        : "查看当次提交内容"}
                    </Button>
                    {expandedId === record.id ? (
                      <div className="mt-3 space-y-3">
                        {record.snapshotMissing ? (
                          <p
                            role="status"
                            className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"
                          >
                            该记录早于批阅快照上线：下面显示的是该任务的最新提交版本，未必与当时一致。
                          </p>
                        ) : null}
                        <TaskSubmissionContent
                          fields={snapshotFields(
                            record.submittedSnapshot?.templateSnapshot,
                          )}
                          data={snapshotData(record.submittedSnapshot)}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {reviews.hasNextPage ? (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={reviews.isFetchingNextPage}
                onClick={() => reviews.fetchNextPage()}
              >
                {reviews.isFetchingNextPage ? "加载中…" : "加载更早的记录"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
