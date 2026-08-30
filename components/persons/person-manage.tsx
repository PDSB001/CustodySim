"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderOpen, Plus, Trash2, UserRound } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { PersonArchiveDialog } from "@/components/persons/person-archive-dialog"
import {
  CUSTODY_LEVEL_LABELS,
  CUSTODY_LEVELS,
  ORGANIZATION_CATEGORIES,
  PRISONER_CUSTODY_STATUS_LABELS,
  PRISONER_CUSTODY_STATUSES,
} from "@/lib/constants"

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(ORGANIZATION_CATEGORIES).nullable(),
})

const MANUALLY_SELECTABLE_CUSTODY_STATUSES = PRISONER_CUSTODY_STATUSES.filter(
  (status) => status !== "ISOLATION",
)
const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  gender: z.string().nullable(),
  age: z.number().nullable(),
  personType: z.string(),
  prisonerNumber: z.string().nullable(),
  customNumber: z.string().nullable(),
  status: z.string(),
  custodyLevel: z.enum(CUSTODY_LEVELS),
  custodyStatus: z.enum(PRISONER_CUSTODY_STATUSES),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  userId: z.string().nullable(),
  username: z.string().nullable(),
  archiveRecordCount: z.number(),
  archiveStatus: z.enum([
    "UNFILLED",
    "DRAFT",
    "PENDING_REVIEW",
    "RETURNED",
    "LOCKED",
  ]),
  createdAt: z.string(),
})
const PersonsSchema = z.array(PersonSchema)

export function PersonManage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [archivePerson, setArchivePerson] = useState<z.infer<
    typeof PersonSchema
  > | null>(null)
  const [form, setForm] = useState({
    name: "",
    gender: "",
    age: "",
    organizationId: "",
    customNumber: "",
    custodyLevel: "GENERAL",
    custodyStatus: "OUT_OF_CUSTODY",
  })
  const persons = useQuery({
    queryKey: ["persons"],
    queryFn: () => requestApi("/api/admin/persons", PersonsSchema),
  })
  const organizations = useQuery({
    queryKey: ["admin-organizations", "person-options"],
    queryFn: () => requestApi("/api/admin/orgs", z.array(OrganizationSchema)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/persons", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          gender: form.gender || null,
          age: form.age ? Number(form.age) : null,
          organizationId: form.organizationId || null,
          customNumber: form.customNumber || null,
          personType: "SUPERVISED",
          status: "active",
          custodyLevel: form.custodyLevel,
          custodyStatus: form.custodyStatus,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["persons"] })
      setOpen(false)
      setForm({
        name: "",
        gender: "",
        age: "",
        organizationId: "",
        customNumber: "",
        custodyLevel: "GENERAL",
        custodyStatus: "OUT_OF_CUSTODY",
      })
      toast.success("人员已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const updateCustodyProfile = useMutation({
    mutationFn: ({
      id,
      custodyLevel,
      custodyStatus,
    }: {
      id: string
      custodyLevel: (typeof CUSTODY_LEVELS)[number]
      custodyStatus: (typeof PRISONER_CUSTODY_STATUSES)[number]
    }) =>
      requestApi(
        `/api/admin/persons/${id}/custody-profile`,
        z.object({ id: z.string() }),
        {
          method: "PATCH",
          body: JSON.stringify({ custodyLevel, custodyStatus }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["persons"] })
      queryClient.invalidateQueries({ queryKey: ["checkin-rules"] })
      toast.success("监管档案已更新")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "更新失败"),
  })
  const updateRoom = useMutation({
    mutationFn: ({
      id,
      organizationId,
    }: {
      id: string
      organizationId: string
    }) =>
      requestApi(
        `/api/admin/persons/${id}/room`,
        z.object({ id: z.string() }),
        {
          method: "PATCH",
          body: JSON.stringify({ organizationId }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["persons"] })
      queryClient.invalidateQueries({ queryKey: ["checkin-rules"] })
      toast.success("所在监室已调整")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "调整监室失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/persons/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["persons"] })
      toast.success("人员已删除")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "删除失败"),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="基础资料"
        title="人员管理"
        description="维护被监管人员基础档案，并关联其组织与账户。"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus />
                新建人员
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建人员</DialogTitle>
              </DialogHeader>
              <div className="grid gap-5 py-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>姓名</Label>
                  <Input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>性别</Label>
                  <Select
                    value={form.gender}
                    onValueChange={(gender) =>
                      setForm({
                        ...form,
                        gender: gender === "__none__" ? "" : gender,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="未填写" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未填写</SelectItem>
                      <SelectItem value="男">男</SelectItem>
                      <SelectItem value="女">女</SelectItem>
                      <SelectItem value="其他">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>年龄</Label>
                  <Input
                    type="number"
                    value={form.age}
                    onChange={(event) =>
                      setForm({ ...form, age: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>自定义编号</Label>
                  <Input
                    value={form.customNumber}
                    onChange={(event) =>
                      setForm({ ...form, customNumber: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>归属监室</Label>
                  <Select
                    value={form.organizationId}
                    onValueChange={(organizationId) =>
                      setForm({
                        ...form,
                        organizationId:
                          organizationId === "__none__" ? "" : organizationId,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择监室" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">请选择监室</SelectItem>
                      {organizations.data
                        ?.filter(
                          (organization) => organization.category === "ROOM",
                        )
                        .map((organization) => (
                          <SelectItem
                            key={organization.id}
                            value={organization.id}
                          >
                            {organization.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>监管级别</Label>
                  <Select
                    value={form.custodyLevel}
                    onValueChange={(custodyLevel) =>
                      setForm({ ...form, custodyLevel })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTODY_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {CUSTODY_LEVEL_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>囚犯状态</Label>
                  <Select
                    value={form.custodyStatus}
                    onValueChange={(custodyStatus) =>
                      setForm({ ...form, custodyStatus })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MANUALLY_SELECTABLE_CUSTODY_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {PRISONER_CUSTODY_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="brand"
                  className="sm:col-span-2"
                  disabled={!form.name || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "创建中…" : "创建人员"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
              <tr>
                <th className="px-5 py-3">人员</th>
                <th className="px-5 py-3">编号</th>
                <th className="px-5 py-3">所在监室</th>
                <th className="px-5 py-3">个人档案</th>
                <th className="px-5 py-3">监管级别</th>
                <th className="px-5 py-3">囚犯状态</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {persons.data?.map((person) => (
                <tr key={person.id} className="group/row hover:bg-muted/30">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <IconChip
                        icon={UserRound}
                        size="sm"
                        className="group-hover/row:bg-brand-500/10 group-hover/row:text-brand-700"
                      />
                      <div>
                        <p className="text-foreground font-medium">
                          {person.name}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {person.gender ?? "未填写"}
                          {person.age ? ` · ${person.age} 岁` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant="brand">
                      {person.prisonerNumber ?? person.customNumber ?? "待分配"}
                    </Badge>
                  </td>
                  <td className="px-5 py-4">
                    <Select
                      aria-label={`${person.name} 的所在监室`}
                      value={person.organizationId ?? undefined}
                      disabled={updateRoom.isPending}
                      onValueChange={(organizationId) =>
                        updateRoom.mutate({ id: person.id, organizationId })
                      }
                    >
                      <SelectTrigger className="h-9 min-w-32">
                        <SelectValue placeholder="未分配监室" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.data
                          ?.filter(
                            (organization) => organization.category === "ROOM",
                          )
                          .map((organization) => (
                            <SelectItem
                              key={organization.id}
                              value={organization.id}
                            >
                              {organization.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <StatusPill
                        tone={archiveStatusTone(person.archiveStatus)}
                      >
                        {archiveStatusLabel(person.archiveStatus)}
                      </StatusPill>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setArchivePerson(person)}
                      >
                        <FolderOpen />
                        查看
                      </Button>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Select
                      aria-label={`${person.name} 的监管级别`}
                      value={person.custodyLevel}
                      disabled={updateCustodyProfile.isPending}
                      onValueChange={(value) =>
                        updateCustodyProfile.mutate({
                          id: person.id,
                          custodyLevel:
                            value as (typeof CUSTODY_LEVELS)[number],
                          custodyStatus: person.custodyStatus,
                        })
                      }
                    >
                      <SelectTrigger className="h-9 min-w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CUSTODY_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {CUSTODY_LEVEL_LABELS[level]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-5 py-4">
                    <Select
                      aria-label={`${person.name} 的囚犯状态`}
                      value={person.custodyStatus}
                      disabled={updateCustodyProfile.isPending}
                      onValueChange={(value) =>
                        updateCustodyProfile.mutate({
                          id: person.id,
                          custodyLevel: person.custodyLevel,
                          custodyStatus:
                            value as (typeof PRISONER_CUSTODY_STATUSES)[number],
                        })
                      }
                    >
                      <SelectTrigger className="h-9 min-w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {person.custodyStatus === "ISOLATION" ? (
                          <SelectItem value="ISOLATION" disabled>
                            禁闭执行中（系统控制）
                          </SelectItem>
                        ) : null}
                        {MANUALLY_SELECTABLE_CUSTODY_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {PRISONER_CUSTODY_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除 ${person.name}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(`确定删除“${person.name}”吗？`))
                          remove.mutate(person.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
              {persons.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      icon={UserRound}
                      title="还没有人员"
                      description="先创建被监管人员，再分配组织归属与监管级别。"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {archivePerson ? (
        <PersonArchiveDialog
          person={archivePerson}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setArchivePerson(null)
          }}
        />
      ) : null}
    </div>
  )
}

function archiveStatusLabel(
  status: z.infer<typeof PersonSchema>["archiveStatus"],
) {
  return (
    {
      UNFILLED: "未填写",
      DRAFT: "已填写草稿",
      PENDING_REVIEW: "审核中",
      RETURNED: "待修改",
      LOCKED: "已归档",
    }[status] ?? status
  )
}

function archiveStatusTone(
  status: z.infer<typeof PersonSchema>["archiveStatus"],
) {
  if (status === "LOCKED") return "success" as const
  if (status === "PENDING_REVIEW") return "pending" as const
  if (status === "RETURNED") return "warning" as const
  return "neutral" as const
}
