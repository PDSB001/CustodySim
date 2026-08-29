"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldAlert } from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/toast"

const Settings = z.object({ templateId: z.string().uuid().nullable(), scheduleTime: z.string(), timeoutMinutes: z.number() })
const Template = z.object({ id: z.string(), name: z.string(), kind: z.string() })
const Response = z.object({ settings: Settings, templates: z.array(Template) })

export function IsolationSettingsManage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["isolation-settings"], queryFn: () => requestApi("/api/admin/isolation-settings", Response) })
  const [templateId, setTemplateId] = useState<string | undefined>(undefined)
  const [scheduleTime, setScheduleTime] = useState<string | undefined>(undefined)
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | undefined>(undefined)
  const settings = query.data?.settings
  const save = useMutation({
    mutationFn: () => requestApi("/api/admin/isolation-settings", Settings, { method: "PUT", body: JSON.stringify({ templateId: templateId === "__none__" ? null : templateId ?? settings?.templateId ?? null, scheduleTime: scheduleTime ?? settings?.scheduleTime ?? "19:00", timeoutMinutes: timeoutMinutes ?? settings?.timeoutMinutes ?? 240 }) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["isolation-settings"] }); toast.success("禁闭设置已保存") },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
  })
  return <div className="workspace-stack"><PageHeader eyebrow="监管执行" title="禁闭设置" description="控制禁闭期间每日任务表单的下发时间与完成时限。" /><Card><CardContent className="grid gap-5 p-5 sm:p-6 md:grid-cols-3 md:items-end"><div className="space-y-2 md:col-span-3"><p className="text-sm text-muted-foreground">禁闭由周度积分结算自动触发；此处只控制禁闭期间每天生成的任务。</p></div><div className="space-y-2"><Label>每日任务表单</Label><Select value={templateId ?? settings?.templateId ?? "__none__"} onValueChange={setTemplateId}><SelectTrigger className="w-full"><SelectValue placeholder="选择任务表单" /></SelectTrigger><SelectContent><SelectItem value="__none__">使用系统默认检讨</SelectItem>{query.data?.templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>每日下发时间</Label><Input type="time" value={scheduleTime ?? settings?.scheduleTime ?? "19:00"} onChange={(event) => setScheduleTime(event.target.value)} /></div><div className="space-y-2"><Label>完成时限（分钟）</Label><Input type="number" min="1" max="10080" value={timeoutMinutes ?? settings?.timeoutMinutes ?? 240} onChange={(event) => setTimeoutMinutes(Number(event.target.value))} /></div><Button variant="brand" disabled={save.isPending} onClick={() => save.mutate()}><ShieldAlert />{save.isPending ? "保存中…" : "保存禁闭设置"}</Button></CardContent></Card></div>
}
