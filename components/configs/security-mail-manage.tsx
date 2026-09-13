"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

const Status = z.object({
  bindingEnabled: z.boolean(),
  configured: z.boolean(),
  provider: z.string(),
  region: z.string(),
  sender: z.string().nullable(),
  pending: z.number(),
  failed: z.number(),
  sent: z.number(),
})
export function SecurityMailManage() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["security-mail-admin"],
    queryFn: () => requestApi("/api/admin/security-mail", Status),
  })
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const save = useMutation({
    mutationFn: (bindingEnabled: boolean) =>
      requestApi(
        "/api/admin/security-mail",
        z.object({ bindingEnabled: z.boolean() }),
        { method: "PUT", body: JSON.stringify({ bindingEnabled }) },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["security-mail-admin"] })
      setEnabled(null)
      toast.success("邮件策略已保存")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="账号安全"
        title="安全邮件"
        description="管理邮箱绑定与腾讯云邮件服务状态。"
      />
      <Card>
        <CardContent className="space-y-4 p-5">
          {query.isPending && <p role="status">正在加载…</p>}
          {query.isError && <p role="alert">{query.error.message}</p>}
          {query.data && (
            <>
              <p>
                服务：{query.data.provider} ·{" "}
                {query.data.configured
                  ? "配置齐全（实际投递仍需联调）"
                  : "配置未完成"}
              </p>
              <p>
                地域：{query.data.region || "未配置"} · 发信地址：
                {query.data.sender || "未配置"}
              </p>
              <p className="text-sm">
                近 14 天安全通知：已提交 {query.data.sent} · 等待发送{" "}
                {query.data.pending} · 重试耗尽 {query.data.failed}
              </p>
              {!query.data.configured && (
                <p className="text-muted-foreground text-sm">
                  请在服务端配置
                  TENCENT_SES_SECRET_ID、TENCENT_SES_SECRET_KEY、TENCENT_SES_REGION、TENCENT_SES_FROM、TENCENT_SES_CODE_TEMPLATE_ID
                  和 TENCENT_SES_NOTICE_TEMPLATE_ID。
                </p>
              )}
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="允许绑定安全邮箱"
                  checked={enabled ?? query.data.bindingEnabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  disabled={save.isPending}
                />
                允许绑定安全邮箱
              </label>
              <p className="text-muted-foreground text-sm">
                验证码 5 分钟有效，每 60 秒可重发；每账号及收件邮箱每小时最多 5
                次发送尝试，每 IP 最多 20 次。每个验证码最多验证 5
                次。关闭绑定不影响已绑定邮箱接收安全通知。
              </p>
              <p className="text-muted-foreground text-sm">
                登录继续使用验证器或离线恢复码。邮箱验证不能关闭或替代
                MFA。安全通知发送失败会有限重试，重试耗尽请检查腾讯云投递日志。
              </p>
              <Button
                disabled={
                  save.isPending ||
                  ((enabled ?? query.data.bindingEnabled) &&
                    !query.data.configured)
                }
                onClick={() =>
                  save.mutate(enabled ?? query.data!.bindingEnabled)
                }
              >
                保存策略
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => void query.refetch()}>
            刷新状态
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
