"use client"

import { useQuery } from "@tanstack/react-query"
import { History } from "lucide-react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

const AuditSchema = z.object({
  id: z.string(),
  actorName: z.string(),
  actorRole: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  entityType: z.string(),
  createdAt: z.string(),
})

export function AuditTimeline() {
  const audits = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => requestApi("/api/audit-logs", z.array(AuditSchema)),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="操作审计"
        title="审计日志"
        description="记录组织、账号、人员和编号管理操作，保证基础数据可追溯。"
      />
      <Card>
        <CardContent className="p-5 sm:p-7">
          <div>
            {audits.data?.map((audit, index) => (
              <div
                key={audit.id}
                className="relative flex gap-3.5 pb-5 last:pb-0"
              >
                <div className="relative flex flex-col items-center">
                  <IconChip icon={History} size="sm" tone="brand" />
                  {index !== (audits.data.length ?? 0) - 1 && (
                    <span className="mt-1 h-full w-px bg-border" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {audit.actionLabel}
                    </p>
                    <Badge variant="brand">{audit.entityType}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {audit.actorName} · {audit.actorRole}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">
                    {formatDate(audit.createdAt)}
                  </p>
                </div>
              </div>
            ))}
            {audits.data?.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                暂无审计记录
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}