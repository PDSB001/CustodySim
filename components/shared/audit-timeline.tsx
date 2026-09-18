"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { History } from "lucide-react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { LoadingBlock } from "@/components/shared/query-state-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const AuditSchema = z.object({
  id: z.string(),
  actorName: z.string(),
  actorRole: z.string(),
  actorType: z.string().catch("USER"),
  action: z.string(),
  actionLabel: z.string(),
  entityType: z.string(),
  createdAt: z.string(),
})

const AuditPageSchema = z.object({
  items: z.array(AuditSchema),
  nextCursor: z.string().nullable(),
})

const PAGE_SIZE = 50

export function AuditTimeline() {
  const audits = useInfiniteQuery({
    queryKey: ["audit-logs"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestApi(
        pageParam
          ? `/api/audit-logs?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(pageParam)}`
          : `/api/audit-logs?limit=${PAGE_SIZE}`,
        AuditPageSchema,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const records = audits.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="操作审计"
        title="审计日志"
        description={`记录组织、账号、人员和编号管理操作，保证基础数据可追溯。按时间倒序加载，每次 ${PAGE_SIZE} 条。`}
      />
      <Card>
        <CardContent className="p-5 sm:p-7">
          <div>
            {audits.isLoading ? (
              <LoadingBlock rows={6} />
            ) : records.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                暂无审计记录
              </p>
            ) : (
              records.map((audit, index) => (
                <div
                  key={audit.id}
                  className="relative flex gap-3.5 pb-5 last:pb-0"
                >
                  <div className="relative flex flex-col items-center">
                    <IconChip icon={History} size="sm" tone="brand" />
                    {index !== records.length - 1 && (
                      <span className="bg-border mt-1 h-full w-px" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-foreground font-medium">
                        {audit.actionLabel}
                      </p>
                      <Badge variant="brand">{audit.entityType}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          audit.actorType === "SYSTEM_AI" ? "info" : "secondary"
                        }
                      >
                        {audit.actorType === "SYSTEM_AI"
                          ? "AI 系统"
                          : "真人用户"}
                      </Badge>
                      <p className="text-muted-foreground text-sm">
                        {audit.actorName} · {audit.actorRole}
                      </p>
                    </div>
                    <p className="text-muted-foreground/70 mt-0.5 text-xs">
                      {formatDate(audit.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          {audits.hasNextPage ? (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={audits.isFetchingNextPage}
                onClick={() => audits.fetchNextPage()}
              >
                {audits.isFetchingNextPage ? "加载中…" : "加载更早的记录"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
