"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellRing, Megaphone, Send } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const NoticeSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  targetRole: z.string(),
  priority: z.string(),
  published: z.boolean().optional(),
  publishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable().optional(),
})
const NoticesSchema = z.array(NoticeSchema)

const audienceText: Record<string, string> = { ALL: "全体人员", SUPERVISED: "在押人员", SUPERVISOR: "监管员", ADMIN: "管理处" }
const priorityText: Record<string, string> = { NORMAL: "普通", IMPORTANT: "重要", URGENT: "紧急" }

export function NoticesWorkspace({ title = "通知公告" }: { title?: string }) {
  const client = useQueryClient()
  const notices = useQuery({ queryKey: ["notices"], queryFn: () => requestApi("/api/notices", NoticesSchema) })
  const read = useMutation({
    mutationFn: (noticeId: string) => requestApi("/api/notices", z.object({ id: z.string() }), { method: "PATCH", body: JSON.stringify({ noticeId }) }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notices"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
    },
  })
  return <div className="workspace-stack mx-auto max-w-5xl"><PageHeader eyebrow="监所公示" title={title} description="查阅监所下达的正式通知。阅读后请确认已阅，并留意通知中的执行时间与要求。" />{notices.data?.map((notice) => <Card key={notice.id} className={notice.readAt ? "" : "border-brand-500/40"}><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle className="flex items-center gap-2"><Megaphone className="size-4" />{notice.title}</CardTitle><span className="text-muted-foreground text-xs">{priorityText[notice.priority] ?? notice.priority}{notice.readAt ? " · 已读" : " · 未读"}</span></div></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-7">{notice.content}</p><div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span>发布时间：{formatDate(notice.publishedAt ?? notice.createdAt)}</span>{!notice.readAt ? <Button size="sm" variant="outline" disabled={read.isPending} onClick={() => read.mutate(notice.id)}>确认已阅</Button> : null}</div></CardContent></Card>)}{notices.data?.length === 0 ? <EmptyState icon={BellRing} title="暂无通知" description="当前暂无已发布的监所通知。" /> : null}</div>
}

export function NoticeManage() {
  const client = useQueryClient()
  const notices = useQuery({ queryKey: ["admin-notices"], queryFn: () => requestApi("/api/admin/notices", NoticesSchema) })
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [targetRole, setTargetRole] = useState("ALL")
  const [priority, setPriority] = useState("NORMAL")
  const publish = useMutation({
    mutationFn: () => requestApi("/api/admin/notices", NoticeSchema, { method: "POST", body: JSON.stringify({ title, content, targetRole, priority, published: true, expiresAt: null }) }),
    onSuccess: () => { setTitle(""); setContent(""); client.invalidateQueries({ queryKey: ["admin-notices"] }); toast.success("通知已发布") },
    onError: (error) => toast.error(error instanceof Error ? error.message : "发布失败"),
  })
  return <div className="workspace-stack mx-auto max-w-5xl"><PageHeader eyebrow="系统管理" title="监所通知" description="向监管员或在押人员下达正式通知，写明执行要求与时间；监所标语在「标语与文案」中维护。" /><Card><CardHeader><CardTitle className="flex items-center gap-2"><Send className="size-4" />发布通知</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label>通知标题</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="space-y-2"><Label>发送对象</Label><Select value={targetRole} onValueChange={setTargetRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">全体人员</SelectItem><SelectItem value="SUPERVISED">在押人员</SelectItem><SelectItem value="SUPERVISOR">监管员</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>优先级</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NORMAL">普通</SelectItem><SelectItem value="IMPORTANT">重要</SelectItem><SelectItem value="URGENT">紧急</SelectItem></SelectContent></Select></div><div className="space-y-2 sm:col-span-2"><Label>通知内容</Label><Textarea value={content} onChange={(event) => setContent(event.target.value)} className="min-h-32" /></div><div className="sm:col-span-2"><Button disabled={publish.isPending || !title.trim() || !content.trim()} onClick={() => publish.mutate()}><Send />发布通知</Button></div></CardContent></Card><section className="space-y-3"><h2 className="text-lg font-semibold">发布记录</h2>{notices.data?.map((notice) => <Card key={notice.id}><CardContent className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{notice.title}</p><span className="text-muted-foreground text-xs">{audienceText[notice.targetRole] ?? "指定人员"} · {priorityText[notice.priority] ?? notice.priority}</span></div><p className="text-muted-foreground mt-2 whitespace-pre-wrap text-sm leading-6">{notice.content}</p></CardContent></Card>)}</section></div>
}
