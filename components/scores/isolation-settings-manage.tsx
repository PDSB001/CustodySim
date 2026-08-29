"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, ShieldAlert, X } from "lucide-react"
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

const Settings = z.object({ templateIds: z.array(z.string().uuid()), scheduleTime: z.string(), timeoutMinutes: z.number() })
const Template = z.object({ id: z.string(), name: z.string(), kind: z.string() })
const Response = z.object({ settings: Settings, templates: z.array(Template) })

export function IsolationSettingsManage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["isolation-settings"], queryFn: () => requestApi("/api/admin/isolation-settings", Response) })
  const [templateIds, setTemplateIds] = useState<string[] | undefined>(undefined)
  const [templateToAdd, setTemplateToAdd] = useState("")
  const [scheduleTime, setScheduleTime] = useState<string | undefined>(undefined)
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | undefined>(undefined)
  const settings = query.data?.settings
  const save = useMutation({
    mutationFn: () => requestApi("/api/admin/isolation-settings", Settings, { method: "PUT", body: JSON.stringify({ templateIds: templateIds ?? settings?.templateIds ?? [], scheduleTime: scheduleTime ?? settings?.scheduleTime ?? "19:00", timeoutMinutes: timeoutMinutes ?? settings?.timeoutMinutes ?? 240 }) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["isolation-settings"] }); toast.success("禁闭设置已保存") },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
  })
  return <div className="workspace-stack"><PageHeader eyebrow="监管执行" title="禁闭设置" description="控制禁闭期间每日任务表单的下发时间与完成时限。" /><Card><CardContent className="grid gap-5 p-5 sm:p-6 md:grid-cols-3 md:items-end"><div className="space-y-2 md:col-span-3"><p className="text-sm text-muted-foreground">禁闭由周度积分结算自动触发；每天会为下方每个表单各生成一条任务。</p></div><div className="space-y-2 md:col-span-3"><Label>每日任务表单（可多选）</Label><div className="space-y-2">{(templateIds ?? settings?.templateIds ?? []).map((id) => <div key={id} className="border-input bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{query.data?.templates.find((template) => template.id === id)?.name ?? id}</span><button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setTemplateIds((templateIds ?? settings?.templateIds ?? []).filter((item) => item !== id))} aria-label="删除任务表单"><X className="size-4" /></button></div>)}<div className="flex gap-2"><Select value={templateToAdd} onValueChange={setTemplateToAdd}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="选择任务表单" /></SelectTrigger><SelectContent>{query.data?.templates.map((template) => <SelectItem key={template.id} value={template.id} disabled={(templateIds ?? settings?.templateIds ?? []).includes(template.id)}>{template.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="icon" disabled={!templateToAdd} onClick={() => { setTemplateIds((current) => [...(current ?? settings?.templateIds ?? []), templateToAdd]); setTemplateToAdd("") }} aria-label="添加任务表单"><Plus className="size-4" /></Button></div></div></div><div className="space-y-2"><Label>每日下发时间</Label><Input type="time" value={scheduleTime ?? settings?.scheduleTime ?? "19:00"} onChange={(event) => setScheduleTime(event.target.value)} /></div><div className="space-y-2"><Label>完成时限（分钟）</Label><Input type="number" min="1" max="10080" value={timeoutMinutes ?? settings?.timeoutMinutes ?? 240} onChange={(event) => setTimeoutMinutes(Number(event.target.value))} /></div><Button variant="brand" disabled={save.isPending || !(templateIds ?? settings?.templateIds ?? []).length} onClick={() => save.mutate()}><ShieldAlert />{save.isPending ? "保存中…" : "保存禁闭设置"}</Button></CardContent></Card></div>
}
