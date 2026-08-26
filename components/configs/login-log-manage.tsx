"use client"

import { useQuery } from "@tanstack/react-query"
import { LogIn } from "lucide-react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Card, CardContent } from "@/components/ui/card"

const LoginLogSchema = z.object({
  id: z.string(),
  username: z.string(),
  ip: z.string().nullable(),
  success: z.boolean(),
  failReason: z.string().nullable(),
  createdAt: z.string(),
})

export function LoginLogManage() {
  const logs = useQuery({
    queryKey: ["login-logs"],
    queryFn: () => requestApi("/api/admin/login-logs", z.array(LoginLogSchema)),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="账户安全"
        title="登录日志"
        description="查看最近 200 条账号登录尝试，便于识别异常访问。"
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <tr>
                <th className="px-5 py-3">账号</th>
                <th className="px-5 py-3">结果</th>
                <th className="px-5 py-3">IP</th>
                <th className="px-5 py-3">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {logs.data?.map((log) => (
                <tr key={log.id} className="hover:bg-muted/30">
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <LogIn className="size-4 text-brand-700" />
                      {log.username}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill tone={log.success ? "success" : "danger"}>
                      {log.success ? "成功" : (log.failReason ?? "失败")}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                    {log.ip ?? "本机"}
                  </td>
                  <td className="px-5 py-4 font-numeric text-xs text-muted-foreground">
                    {formatDate(log.createdAt)}
                  </td>
                </tr>
              ))}
              {logs.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-0">
                    <EmptyState
                      icon={LogIn}
                      title="暂无登录日志"
                      description="系统中暂未记录任何登录尝试。"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}