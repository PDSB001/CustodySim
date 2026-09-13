"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"

const Settings = z.object({
  enabled: z.boolean(),
  actorId: z.string().nullable(),
  templateIds: z.array(z.string()),
  revision: z.string().nullable(),
})
const ResponseSchema = z.object({
  settings: Settings,
  storageReady: z.boolean(),
  apiKeyConfigured: z.boolean(),
  model: z.string(),
  actors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      username: z.string(),
      role: z.string(),
    }),
  ),
  templates: z.array(
    z.object({ id: z.string(), name: z.string(), restricted: z.boolean() }),
  ),
})
type SettingsValue = z.infer<typeof Settings>

export function AutoReviewManage() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["auto-review-settings"],
    queryFn: () => requestApi("/api/admin/auto-review", ResponseSchema),
  })
  const [draft, setDraft] = useState<SettingsValue | null>(null)
  const settings = draft ?? query.data?.settings
  const save = useMutation({
    mutationFn: (value: SettingsValue) =>
      requestApi("/api/admin/auto-review", Settings, {
        method: "PUT",
        body: JSON.stringify(value),
      }),
    onSuccess: (value) => {
      client.setQueryData<z.infer<typeof ResponseSchema>>(
        ["auto-review-settings"],
        (old) => (old ? { ...old, settings: value } : old),
      )
      setDraft(null)
      void client.invalidateQueries({ queryKey: ["auto-review-settings"] })
      toast.success(
        value.enabled ? "自动审核已开启，将在下一轮扫描生效" : "自动审核已关闭",
      )
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "保存失败"),
  })
  const change = (patch: Partial<SettingsValue>) =>
    settings && setDraft({ ...settings, ...patch })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="监管执行"
        title="自动审核"
        description="选择由模型审核的任务模板，不确定的回答保留人工处理。"
      />
      {query.isPending && <p role="status">正在读取设置…</p>}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新加载
          </Button>
        </div>
      )}
      {query.data && settings && (
        <Card>
          <CardContent className="space-y-6 p-5 sm:p-6">
            <div className="space-y-2 text-sm">
              <p role="status">
                当前状态：{query.data.settings.enabled ? "已开启" : "已关闭"} ·
                模型：{query.data.model}
              </p>
              <p>
                API Key：
                {query.data.apiKeyConfigured
                  ? "已在服务端配置"
                  : "未配置，请在服务端设置 GLM_API_KEY"}
              </p>
              {!query.data.storageReady && (
                <p role="alert" className="text-destructive">
                  数据库尚未升级，请部署时运行 pnpm db:push 后刷新。
                </p>
              )}
            </div>
            <fieldset
              disabled={save.isPending || !query.data.storageReady}
              className="space-y-6 disabled:opacity-60"
            >
              <label className="flex items-center gap-3 font-medium">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="启用自动审核"
                  checked={settings.enabled}
                  onChange={(event) =>
                    change({ enabled: event.target.checked })
                  }
                  className="size-5"
                />
                启用自动审核
              </label>
              <div className="space-y-2">
                <Label htmlFor="auto-review-actor">审核账号</Label>
                <select
                  id="auto-review-actor"
                  className="border-input bg-background w-full rounded-md border p-2 text-sm"
                  value={settings.actorId ?? ""}
                  onChange={(event) =>
                    change({ actorId: event.target.value || null })
                  }
                >
                  <option value="">请选择审核账号</option>
                  {settings.actorId &&
                    !query.data.actors.some(
                      (a) => a.id === settings.actorId,
                    ) && (
                      <option value={settings.actorId}>
                        原审核账号已不可用，请重新选择
                      </option>
                    )}
                  {query.data.actors.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}（{actor.username} ·{" "}
                      {actor.role === "ADMIN" ? "管理员" : "监管员"}）
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-sm">
                  审核记录归属此账号；监管员只能审核其监管范围内的任务。
                </p>
              </div>
              <fieldset className="space-y-3">
                <legend className="mb-2 font-medium">允许自动审核的模板</legend>
                {!query.data.templates.length && (
                  <p className="text-muted-foreground text-sm">
                    当前环境暂无模板，请先创建任务模板。
                  </p>
                )}
                {query.data.templates.map((template) => (
                  <label
                    key={template.id}
                    className="flex items-center gap-3 rounded-md border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={
                        template.restricted &&
                        !settings.templateIds.includes(template.id)
                      }
                      checked={settings.templateIds.includes(template.id)}
                      onChange={(event) =>
                        change({
                          templateIds: event.target.checked
                            ? [...settings.templateIds, template.id]
                            : settings.templateIds.filter(
                                (id) => id !== template.id,
                              ),
                        })
                      }
                    />
                    {template.name}
                    {template.restricted && (
                      <span className="text-muted-foreground">
                        （仅人工审核）
                      </span>
                    )}
                  </label>
                ))}
                {settings.templateIds
                  .filter(
                    (id) => !query.data!.templates.some((t) => t.id === id),
                  )
                  .map((id) => (
                    <div key={id} className="flex items-center gap-3 text-sm">
                      <span>已删除的模板</span>
                      <Button
                        variant="outline"
                        onClick={() =>
                          change({
                            templateIds: settings.templateIds.filter(
                              (item) => item !== id,
                            ),
                          })
                        }
                      >
                        移除失效选择
                      </Button>
                    </div>
                  ))}
              </fieldset>
              <p className="text-muted-foreground text-sm">
                启用后，所选模板的待审核内容会发送给智谱，包括尚未到期的已有提交。图片、禁闭检讨和需要现场核验的内容保留人工审核；自动通过和退回会产生相应审核记录与积分结果。
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="brand"
                  disabled={
                    settings.enabled &&
                    (!query.data.apiKeyConfigured ||
                      !settings.actorId ||
                      !settings.templateIds.length)
                  }
                  onClick={() => save.mutate(settings)}
                >
                  {save.isPending ? "保存中…" : "保存设置"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft(null)
                    void query.refetch()
                  }}
                >
                  重新加载设置
                </Button>
              </div>
            </fieldset>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
