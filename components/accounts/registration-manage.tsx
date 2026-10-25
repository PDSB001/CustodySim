"use client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { z } from "zod"
import { requestApi, formatDate } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
const Data = z.object({
  captchaReady: z.boolean(),
  riskBlocks: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      reason: z.string(),
      expiresAt: z.string().nullable(),
    }),
  ),
  riskHasMore: z.boolean(),
  settings: z.object({
    enabled: z.boolean(),
    organizationId: z.string().nullable(),
  }),
  rooms: z.array(z.object({ id: z.string(), name: z.string() })),
  accounts: z.array(
    z.object({
      userId: z.string(),
      username: z.string(),
      name: z.string(),
      state: z.string(),
      status: z.string(),
      trialStart: z.string(),
      trialEnd: z.string(),
      finalScore: z.number().nullable(),
    }),
  ),
  hasMore: z.boolean(),
  blocks: z.array(
    z.object({
      emailHash: z.string(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
  blocksHasMore: z.boolean(),
})
const Saved = z.object({
  saved: z.boolean().optional(),
  removed: z.boolean().optional(),
})
const states: Record<string, string> = {
  PENDING: "考察中",
  PASSED: "已通过",
  FAILED: "未达标",
  BLOCKED: "已拉黑/停用",
}
export function RegistrationManage() {
  const client = useQueryClient()
  const [page, setPage] = useState(0),
    [blocksPage, setBlocksPage] = useState(0)
  const [riskPage, setRiskPage] = useState(0)
  const [email, setEmail] = useState(""),
    [reason, setReason] = useState("")
  const query = useQuery({
    queryKey: ["registration-manage", page, blocksPage, riskPage],
    queryFn: () =>
      requestApi(
        `/api/admin/registration?page=${page}&blocksPage=${blocksPage}&riskPage=${riskPage}`,
        Data,
      ),
  })
  const mutation = useMutation({
    mutationFn: ({ method, body }: { method: string; body: object }) =>
      requestApi("/api/admin/registration", Saved, {
        method,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["registration-manage"] })
      setEmail("")
      setReason("")
      toast.success("已保存")
    },
    onError: (error) => toast.error(error.message),
  })
  const data = query.data
  return (
    <div className="space-y-6">
      <PageHeader
        title="注册与首周考察"
        description="被监管人自由注册，首周结算积分须大于 0，未达标自动停用。邮箱仅保存摘要，不发送验证邮件。"
      />
      {query.isPending && <p role="status">加载中…</p>}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => query.refetch()}>重试</Button>
        </div>
      )}
      {data && (
        <>
          <section className="bg-card space-y-4 rounded-xl border p-5">
            <h2 className="font-semibold">开放设置</h2>
            <p role="status" className="text-sm">
              Turnstile 人机验证：
              {data.captchaReady
                ? "已配置"
                : "未配置，注册将被阻止；请配置服务器 TURNSTILE_SITE_KEY 和 TURNSTILE_SECRET_KEY"}
            </p>
            <Label
              className="flex items-center gap-3"
              htmlFor="registration-enabled"
            >
              开放 Web 自由注册
              <Switch
                id="registration-enabled"
                checked={data.settings.enabled}
                disabled={mutation.isPending}
                onCheckedChange={(enabled) =>
                  mutation.mutate({
                    method: "PATCH",
                    body: { ...data.settings, enabled },
                  })
                }
              />
            </Label>
            <div className="space-y-2">
              <Label htmlFor="registration-room">新账号默认监室</Label>
              <select
                id="registration-room"
                name="organizationId"
                className="bg-background block w-full rounded-md border p-2 text-sm"
                value={data.settings.organizationId ?? ""}
                disabled={mutation.isPending}
                onChange={(event) =>
                  mutation.mutate({
                    method: "PATCH",
                    body: {
                      ...data.settings,
                      organizationId: event.target.value || null,
                    },
                  })
                }
              >
                <option value="">首次注册时自动创建新用户监室</option>
                {data.rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-muted-foreground text-sm">
              自注册次日起计算七个完整上海自然日，截止后预留 10
              分钟结算。新账号自动建立普管、在押档案，不追补注册前的打卡和任务。
            </p>
          </section>
          <section className="space-y-3">
            <h2 className="font-semibold">注册账号</h2>
            {!data.accounts.length && (
              <p className="text-muted-foreground text-sm">
                暂无自主注册账号。
              </p>
            )}
            {data.accounts.map((account) => (
              <article
                key={account.userId}
                className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
              >
                <div>
                  <p className="font-medium">
                    {account.name} · {account.username}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {states[account.state] ?? account.state} ·{" "}
                    {account.status === "active" ? "启用" : "停用"} · 结算积分{" "}
                    {account.finalScore ?? "待结算"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatDate(account.trialStart)} —{" "}
                    {formatDate(account.trialEnd)}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  disabled={mutation.isPending || account.status !== "active"}
                  onClick={() => {
                    if (
                      window.confirm(
                        "停用此账号并限制其邮箱及已识别浏览器再次注册？",
                      )
                    )
                      mutation.mutate({
                        method: "POST",
                        body: {
                          userId: account.userId,
                          reason: "管理员拉黑自主注册账号",
                        },
                      })
                  }}
                >
                  拉黑并停用
                </Button>
              </article>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={!data.hasMore}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </section>
          <section className="bg-card space-y-3 rounded-xl border p-5">
            <h2 className="font-semibold">邮箱黑名单</h2>
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault()
                if (
                  !window.confirm(
                    "将此邮箱加入黑名单，并停用其关联的自主注册账号？",
                  )
                )
                  return
                mutation.mutate({ method: "POST", body: { email, reason } })
              }}
            >
              <Input
                name="email"
                aria-label="待拉黑邮箱"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="邮箱"
                required
                maxLength={254}
              />
              <Input
                name="reason"
                aria-label="拉黑原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="原因"
                required
                minLength={2}
                maxLength={300}
              />
              <Button disabled={mutation.isPending}>添加黑名单</Button>
            </form>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending || !email.trim()}
              onClick={() =>
                mutation.mutate({ method: "DELETE", body: { email } })
              }
            >
              解除所填邮箱的黑名单
            </Button>
            <p className="text-muted-foreground text-xs">
              邮箱未验证归属；关联账号会同时限制已识别浏览器。解除邮箱黑名单不会解除浏览器或网络限制，也不会自动恢复账号。
            </p>
            {data.blocks.map((block) => (
              <div
                key={block.emailHash}
                className="flex items-center justify-between gap-3 border-t pt-3"
              >
                <div>
                  <p className="text-sm">
                    摘要 {block.emailHash.slice(0, 12)}… · {block.reason}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatDate(block.createdAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      method: "DELETE",
                      body: { emailHash: block.emailHash },
                    })
                  }
                >
                  解除
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!blocksPage}
                onClick={() => setBlocksPage(blocksPage - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={!data.blocksHasMore}
                onClick={() => setBlocksPage(blocksPage + 1)}
              >
                下一页
              </Button>
            </div>
          </section>
          <section className="bg-card space-y-3 rounded-xl border p-5">
            <h2 className="font-semibold">浏览器与网络限制</h2>
            <p className="text-muted-foreground text-sm">
              违规账号限制已识别浏览器；同一网络七天内至少三个违规账号才临时限制
              24 小时。浏览器标识可被清除，不等同于实名识别。
            </p>
            {!data.riskBlocks.length && (
              <p className="text-sm">暂无限制记录。</p>
            )}
            {data.riskBlocks.map((block) => (
              <div
                key={block.id}
                className="flex items-center justify-between gap-3 border-t pt-3"
              >
                <p className="text-sm">
                  {block.kind === "DEVICE" ? "浏览器" : "网络"} · {block.reason}{" "}
                  ·{" "}
                  {block.expiresAt
                    ? `截止 ${formatDate(block.expiresAt)}`
                    : "持续限制"}
                </p>
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      method: "DELETE",
                      body: { riskBlockId: block.id },
                    })
                  }
                >
                  解除
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!riskPage}
                onClick={() => setRiskPage(riskPage - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={!data.riskHasMore}
                onClick={() => setRiskPage(riskPage + 1)}
              >
                下一页
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
