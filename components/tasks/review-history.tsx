"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { History } from "lucide-react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { LoadingBlock } from "@/components/shared/query-state-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

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
})

const ReviewPage = z.object({
  items: z.array(ReviewRecord),
  nextCursor: z.string().nullable(),
})

const PAGE_SIZE = 30

/**
 * 批阅记录（历史）。
 * 可见范围由接口按角色裁决：管理员全部、监管员为监管范围内、被监管人仅本人。
 */
export function ReviewHistory() {
  const reviews = useInfiniteQuery({
    queryKey: ["review-history"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestApi(
        pageParam
          ? `/api/reviews?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(pageParam)}`
          : `/api/reviews?limit=${PAGE_SIZE}`,
        ReviewPage,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const records = reviews.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="任务批阅 · 记录"
        title="批阅记录"
        description={`按时间倒序查看已完成的批阅结果、评分与意见，每次 ${PAGE_SIZE} 条。`}
      />
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
