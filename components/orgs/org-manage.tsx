"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Building,
  Building2,
  ChevronRight,
  DoorClosed,
  Landmark,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
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
import { cn } from "@/lib/utils"
import {
  ORGANIZATION_CATEGORIES,
  ORGANIZATION_CATEGORY_LABELS,
  type OrganizationCategory,
} from "@/lib/constants"
import { getAllowedChildCategories } from "@/lib/org-hierarchy"
import { buildOrgTree, type OrganizationTreeNode } from "@/lib/org-tree"

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  category: z.enum(ORGANIZATION_CATEGORIES).nullable(),
  sort: z.number(),
  createdAt: z.string(),
})
const OrganizationsSchema = z.array(OrganizationSchema)

const CATEGORY_META: Record<
  OrganizationCategory,
  { icon: LucideIcon; tone: string }
> = {
  ROOT: {
    icon: ShieldCheck,
    tone: "bg-brand-500/10 text-brand-700",
  },
  SUPERVISION_ROOT: {
    icon: Landmark,
    tone: "bg-info/12 text-info",
  },
  SUPERVISION_UNIT: {
    icon: Building,
    tone: "bg-info/12 text-info",
  },
  SUPERVISED_ROOT: {
    icon: UsersRound,
    tone: "bg-pending/12 text-pending",
  },
  WARD: {
    icon: Building2,
    tone: "bg-warning/14 text-warning",
  },
  ROOM: {
    icon: DoorClosed,
    tone: "bg-muted text-muted-foreground",
  },
}

function TreeNode({
  node,
  onDelete,
  onEdit,
  expanded,
  toggle,
}: {
  node: OrganizationTreeNode
  onDelete: (id: string, name: string) => void
  onEdit: (id: string) => void
  expanded: Record<string, boolean>
  toggle: (id: string) => void
}) {
  const category = (node.category ?? "ROOT") as OrganizationCategory
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  const isExpanded = expanded[node.id] ?? true
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div className="group/node flex items-center gap-2 rounded-lg py-1.5 pr-1.5 transition-colors hover:bg-muted/50">
        <button
          type="button"
          aria-label={isExpanded ? "折叠" : "展开"}
          onClick={() => toggle(node.id)}
          disabled={!hasChildren}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-0"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md",
            meta.tone,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm text-foreground",
            category === "ROOT" ? "font-semibold" : "font-medium",
          )}
        >
          {node.name}
        </span>
        <span
          className={cn(
            "hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex",
            meta.tone,
          )}
        >
          {ORGANIZATION_CATEGORY_LABELS[category]}
        </span>
        {category !== "ROOT" && (
          <button
            type="button"
            aria-label={`删除 ${node.name}`}
            onClick={() => onDelete(node.id, node.name)}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover/node:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={`修改 ${node.name}`}
          onClick={() => onEdit(node.id)}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover/node:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
      {isExpanded && hasChildren && (
        <ul className="ml-[11px] border-l border-border/70 pl-1.5">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              onDelete={onDelete}
              onEdit={onEdit}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function OrgManage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState("")
  const [category, setCategory] = useState<OrganizationCategory | "">("")
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const organizations = useQuery({
    queryKey: ["admin-organizations", "full"],
    queryFn: () => requestApi("/api/admin/orgs", OrganizationsSchema),
  })
  const parent = organizations.data?.find(
    (organization) => organization.id === parentId,
  )
  const parentCategory = parent?.category
  const allowedCategories = useMemo(
    () => (parentCategory ? getAllowedChildCategories(parentCategory) : []),
    [parentCategory],
  )
  useEffect(() => {
    if (category && !allowedCategories.includes(category))
      setCategory(allowedCategories[0] ?? "")
  }, [parentId, category, allowedCategories])
  const tree = useMemo(
    () =>
      buildOrgTree(
        (organizations.data ?? []).map((organization) => ({
          ...organization,
          category: organization.category ?? undefined,
        })),
      ),
    [organizations.data],
  )
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/orgs", OrganizationSchema, {
        method: "POST",
        body: JSON.stringify({ name, parentId, category, sort: 0 }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] })
      setOpen(false)
      setName("")
      setParentId("")
      setCategory("")
      toast.success("组织已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/orgs/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] })
      toast.success("组织已删除")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "删除失败"),
  })
  const rename = useMutation({
    mutationFn: () => {
      const organization = organizations.data?.find(
        (item) => item.id === editingOrganizationId,
      )
      if (!organization) throw new Error("组织不存在")
      return requestApi(
        `/api/admin/orgs/${organization.id}`,
        OrganizationSchema,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: editingName,
            parentId: organization.parentId,
            category: organization.category,
            sort: organization.sort,
          }),
        },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] })
      setEditingOrganizationId(null)
      setEditingName("")
      toast.success("组织名称已更新")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "修改失败"),
  })
  const deleteNode = (id: string, organizationName: string) => {
    if (
      window.confirm(
        `确定删除“${organizationName}”吗？含下级、用户或人员的组织不能删除。`,
      )
    )
      remove.mutate(id)
  }
  const editNode = (id: string) => {
    const organization = organizations.data?.find((item) => item.id === id)
    if (!organization) return
    setEditingOrganizationId(id)
    setEditingName(organization.name)
  }
  const toggle = (id: string) =>
    setExpanded((current) => ({ ...current, [id]: !(current[id] ?? true) }))
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="基础资料"
        title="组织架构"
        description="机构下固定分为监管组织与被监管人员集合；人员集合按监区、监室逐级管理。"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus />
                新增下级组织
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增下级组织</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-1">
                <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs leading-5 text-info">
                  系统会按父级自动限制可创建类型：机构下只能创建两大分支；被监管人员集合下只能创建监区，监区下只能创建监室。
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-parent">上级组织</Label>
                  <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger id="org-parent" className="w-full">
                      <SelectValue placeholder="请选择上级组织" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.data
                        ?.filter(
                          (organization) =>
                            organization.category &&
                            getAllowedChildCategories(organization.category)
                              .length > 0,
                        )
                        .map((organization) => (
                          <SelectItem
                            key={organization.id}
                            value={organization.id}
                          >
                            {organization.name}（
                            {
                              ORGANIZATION_CATEGORY_LABELS[
                                organization.category ?? "ROOT"
                              ]
                            }
                            ）
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-category">组织类型</Label>
                  <Select
                    disabled={!parentId}
                    value={category}
                    onValueChange={(value) =>
                      setCategory(value as OrganizationCategory)
                    }
                  >
                    <SelectTrigger id="org-category" className="w-full">
                      <SelectValue placeholder="请选择类型" />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedCategories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {ORGANIZATION_CATEGORY_LABELS[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-name">组织名称</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={
                      category === "WARD"
                        ? "例如：一监区"
                        : category === "ROOM"
                          ? "例如：101 监室"
                          : "请输入组织名称"
                    }
                  />
                </div>
                <Button
                  variant="brand"
                  className="w-full"
                  disabled={
                    !name.trim() || !parentId || !category || create.isPending
                  }
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "创建中…" : "创建组织"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Card className="page-enter">
          <CardContent className="p-4 sm:p-5">
            {organizations.isLoading ? (
              <p className="text-sm text-muted-foreground">
                正在加载组织架构…
              </p>
            ) : tree.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="暂无组织"
                description="点击右上角「新增下级组织」开始搭建监管组织与被监管人员集合。"
              />
            ) : (
              <ul className="flex flex-col">
                {tree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    onDelete={deleteNode}
                    onEdit={editNode}
                    expanded={expanded}
                    toggle={toggle}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="page-enter surface-panel--brand h-fit">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground">
              组织归属规则
            </p>
            <ol className="mt-3 space-y-2.5 text-xs leading-5 text-muted-foreground">
              <li>
                <b className="mr-1 font-semibold text-brand-700">1.</b>{" "}
                顶级机构分为监管组织和被监管人员集合。
              </li>
              <li>
                <b className="mr-1 font-semibold text-brand-700">2.</b>{" "}
                监管组织可按实际管理单位继续细分。
              </li>
              <li>
                <b className="mr-1 font-semibold text-brand-700">3.</b>{" "}
                被监管人员集合必须先划分监区，再划分监室。
              </li>
              <li>
                <b className="mr-1 font-semibold text-brand-700">4.</b>{" "}
                被监管人员应归属到具体监室。
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={Boolean(editingOrganizationId)}
        onOpenChange={(value) => {
          if (!value) {
            setEditingOrganizationId(null)
            setEditingName("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改组织名称</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="editing-org-name">组织名称</Label>
              <Input
                id="editing-org-name"
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                placeholder="请输入组织名称"
              />
            </div>
            <Button
              variant="brand"
              className="w-full"
              disabled={!editingName.trim() || rename.isPending}
              onClick={() => rename.mutate()}
            >
              {rename.isPending ? "保存中…" : "保存名称"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
