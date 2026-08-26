"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageSquareText, Save } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const UiConfigItem = z.object({
  scope: z.enum(["SUPERVISOR", "SUPERVISED"]),
  homeTitle: z.string(),
  homeSubtitle: z.string(),
  homeBanner: z.string(),
})
const UiConfigList = z.array(UiConfigItem)

const SCOPE_LABELS: Record<string, string> = {
  SUPERVISOR: "监管者工作台",
  SUPERVISED: "被监管者服务台",
}

export function UiConfigManage() {
  const queryClient = useQueryClient()
  const configs = useQuery({
    queryKey: ["ui-config"],
    queryFn: () => requestApi("/api/admin/ui-config", UiConfigList),
  })
  const [forms, setForms] = useState<
    Record<string, { homeTitle: string; homeSubtitle: string; homeBanner: string }>
  >({})

  useEffect(() => {
    if (configs.data) {
      setForms(
        Object.fromEntries(
          configs.data.map((config) => [
            config.scope,
            {
              homeTitle: config.homeTitle,
              homeSubtitle: config.homeSubtitle,
              homeBanner: config.homeBanner,
            },
          ]),
        ),
      )
    }
  }, [configs.data])

  const save = useMutation({
    mutationFn: (scope: string) =>
      requestApi("/api/admin/ui-config", UiConfigItem, {
        method: "PUT",
        body: JSON.stringify({ scope, ...forms[scope] }),
      }),
    onSuccess: (_result, scope) => {
      queryClient.invalidateQueries({ queryKey: ["ui-config"] })
      toast.success(`「${SCOPE_LABELS[scope]}」配置已保存`)
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "保存失败"),
  })

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="界面管理"
        title="标语与文案"
        description="配置监管者与被监管者登录后看到的标题、副标题与顶部滚动标语；{name} 会被替换为当前用户名。"
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {(Object.keys(SCOPE_LABELS) as Array<keyof typeof SCOPE_LABELS>).map(
          (scope) => {
            const form = forms[scope]
            if (!form) return null
            return (
              <Card key={scope} className="overflow-hidden">
                <CardContent className="p-5 sm:p-6">
                  <div className="mb-5 flex items-center gap-3 border-b border-border/60 pb-4">
                    <IconChip icon={MessageSquareText} tone="brand" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {SCOPE_LABELS[scope]}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        该角色登录后看到的标题、副标题与横幅
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>标题</Label>
                      <Input
                        value={form.homeTitle}
                        onChange={(e) =>
                          setForms((current) => ({
                            ...current,
                            [scope]: {
                              ...current[scope],
                              homeTitle: e.target.value,
                            },
                          }))
                        }
                        placeholder="例如：你好，{name}"
                      />
                      <p className="text-xs text-muted-foreground">
                        支持占位符：<code className="rounded bg-muted px-1 font-mono text-[10px]">{"{name}"}</code>
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>副标题</Label>
                      <Input
                        value={form.homeSubtitle}
                        onChange={(e) =>
                          setForms((current) => ({
                            ...current,
                            [scope]: {
                              ...current[scope],
                              homeSubtitle: e.target.value,
                            },
                          }))
                        }
                        placeholder="页面简介，一两句话"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>顶部滚动标语（可选）</Label>
                      <Textarea
                        rows={3}
                        value={form.homeBanner}
                        onChange={(e) =>
                          setForms((current) => ({
                            ...current,
                            [scope]: {
                              ...current[scope],
                              homeBanner: e.target.value,
                            },
                          }))
                        }
                        placeholder="留空则不显示；较长文案会自动横向滚动"
                      />
                      <p className="text-xs text-muted-foreground">
                        用于发布通知、提醒或宣传口号；文字超出宽度时会自动滚动
                      </p>
                    </div>

                    <Button
                      variant="brand"
                      className="w-full"
                      disabled={save.isPending}
                      onClick={() => save.mutate(scope)}
                    >
                      <Save />
                      {save.isPending ? "保存中…" : "保存配置"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          },
        )}
      </div>
    </div>
  )
}