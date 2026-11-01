"use client"

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowRight,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { ErrorState, LoadingBlock } from "@/components/shared/query-state-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"
import { AUDIT_LOG_RETENTION_DAYS } from "@/lib/constants"

const AuditSchema = z.object({
  id: z.string(),
  actorName: z.string(),
  actorRole: z.string(),
  actorType: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  createdAt: z.string(),
})
const PageSchema = z.object({
  items: z.array(AuditSchema),
  nextCursor: z.string().nullable(),
})
const DetailSchema = AuditSchema.extend({
  actorId: z.string().nullable(),
  detail: z.unknown(),
})
type Audit = z.infer<typeof AuditSchema>
type Filters = {
  q: string
  actorType: string
  action: string
  entityType: string
  from: string
  to: string
}
const entities: Record<string, string> = {
  user: "账号",
  person: "人员档案",
  organization: "组织",
  rule: "规则",
  rule_group: "规则组",
  report_task: "任务",
  report_submission: "任务提交",
  checkin_task: "打卡任务",
  checkin_tasks: "打卡任务",
  checkin_makeup: "补卡申请",
  application: "申请",
  library_book: "图书",
  app_release: "App 安装包",
  community_post: "社区内容",
  supervision_relation: "监管关系",
}
const roles: Record<string, string> = {
  ADMIN: "管理员",
  SUPERVISOR: "监管员",
  SUPERVISED: "被监管人",
  SYSTEM_AI: "AI 系统",
  SYSTEM: "系统",
}
const actorTypes: Record<string, string> = {
  USER: "真人用户",
  SYSTEM_AI: "AI 系统",
  SYSTEM: "系统任务",
}
const actions = {
  CREATE: "创建",
  UPDATE: "更新",
  DELETE: "删除",
  REGISTER: "注册",
  REPAIR: "维护修复",
  UPLOAD: "上传",
  RESET_PASSWORD: "重置密码",
  APPROVE: "通过",
  REJECT: "退回",
}
const fields: Record<string, string> = {
  reason: "原因",
  username: "用户名",
  name: "名称",
  role: "角色",
  before: "变更前",
  after: "变更后",
  points: "积分",
  score: "得分",
  size: "文件大小（字节）",
  sha256: "SHA-256",
  backup: "备份标识",
  taskIds: "相关任务 ID",
  tasks: "涉及任务数",
  people: "涉及人数",
  pointsBefore: "修复前积分",
  pointsAfter: "修复后积分",
  day: "业务日期",
  week: "所属周次",
  mode: "执行方式",
  database: "数据库",
  termsVersion: "用户协议版本",
  privacyVersion: "隐私政策版本",
  acceptedAt: "同意时间",
}
const time = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "short",
  timeStyle: "medium",
})
function defaults(): Filters {
  const today = getShanghaiDateKey()
  return {
    q: "",
    actorType: "",
    action: "",
    entityType: "",
    from: new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400_000)
      .toISOString()
      .slice(0, 10),
    to: today,
  }
}
function query(filters: Filters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value)
  return params
}
function detailValue(value: unknown) {
  return typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? "—")
}

export function AuditTimeline() {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Filters>(defaults)
  const [filters, setFilters] = useState<Filters>(defaults)
  const [selected, setSelected] = useState<Audit | null>(null)
  const [filterError, setFilterError] = useState("")
  const audits = useInfiniteQuery({
    queryKey: ["audit-logs", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = query(filters)
      params.set("limit", "50")
      if (pageParam) params.set("cursor", pageParam)
      return requestApi(`/api/audit-logs?${params}`, PageSchema, { signal })
    },
    getNextPageParam: (page) => page.nextCursor,
  })
  const detail = useQuery({
    queryKey: ["audit-log-detail", selected?.id],
    enabled: Boolean(selected),
    queryFn: ({ signal }) =>
      requestApi(`/api/audit-logs/${selected!.id}`, DetailSchema, { signal }),
  })
  const records = audits.data?.pages.flatMap((page) => page.items) ?? []
  const values = detail.data?.detail
  const entries =
    values && typeof values === "object" && !Array.isArray(values)
      ? Object.entries(values)
      : values == null
        ? []
        : [["内容", values]]
  function set(key: keyof Filters, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  function reset() {
    const next = defaults()
    setDraft(next)
    setFilters(next)
    setFilterError("")
  }
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="安全与审计"
        title="操作审计"
        description="追溯谁在何时对哪些数据执行了操作，查看业务详情与维护记录。"
        action={
          <Button
            variant="outline"
            disabled={audits.isFetching}
            onClick={() =>
              void client.resetQueries({
                queryKey: ["audit-logs", filters],
                exact: true,
              })
            }
          >
            <RefreshCw className={audits.isFetching ? "animate-spin" : ""} />
            刷新记录
          </Button>
        }
      />
      <form
        className="bg-card space-y-4 rounded-2xl border p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.from && draft.to && draft.from > draft.to) {
            setFilterError("开始日期不能晚于结束日期")
            return
          }
          setFilterError("")
          setFilters({ ...draft, q: draft.q.trim() })
        }}
      >
        <div className="flex items-center gap-2 font-semibold">
          <Search className="text-primary size-4" />
          查找记录
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="audit-search">关键词</Label>
            <Input
              id="audit-search"
              value={draft.q}
              maxLength={120}
              onChange={(event) => set("q", event.target.value)}
              placeholder="操作名称、操作人、日志或对象 ID"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-actor-type">操作人类型</Label>
            <select
              id="audit-actor-type"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={draft.actorType}
              onChange={(event) => set("actorType", event.target.value)}
            >
              <option value="">全部类型</option>
              {Object.entries(actorTypes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-action">操作类型</Label>
            <Input
              id="audit-action"
              list="audit-actions"
              value={draft.action}
              maxLength={80}
              onChange={(event) => set("action", event.target.value)}
              placeholder="全部操作"
            />
            <datalist id="audit-actions">
              {Object.entries(actions).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="audit-entity">业务对象类型</Label>
            <Input
              id="audit-entity"
              list="audit-entities"
              value={draft.entityType}
              maxLength={80}
              onChange={(event) => set("entityType", event.target.value)}
              placeholder="全部业务对象"
            />
            <datalist id="audit-entities">
              {Object.entries(entities).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-from">开始日期</Label>
            <Input
              id="audit-from"
              type="date"
              value={draft.from}
              onChange={(event) => set("from", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-to">结束日期</Label>
            <Input
              id="audit-to"
              type="date"
              value={draft.to}
              onChange={(event) => set("to", event.target.value)}
            />
          </div>
        </div>
        {filterError && (
          <p role="alert" className="text-destructive text-sm">
            {filterError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">
            <Search />
            应用筛选
          </Button>
          <Button type="button" variant="ghost" onClick={reset}>
            重置
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const next = { ...draft, from: "", to: "" }
              setDraft(next)
              setFilters(next)
              setFilterError("")
            }}
          >
            不限日期
          </Button>
          <p className="text-muted-foreground text-xs sm:ml-auto">
            日期与时间均按上海时区展示
          </p>
        </div>
      </form>
      <section
        className="bg-card overflow-hidden rounded-2xl border"
        aria-label="审计记录"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <History className="text-primary size-4" />
            记录列表
          </h2>
          <span className="text-muted-foreground text-xs">
            已显示 {records.length} 条 · 由新到旧
          </span>
        </div>
        {audits.isRefetchError &&
          records.length > 0 &&
          !audits.isFetchNextPageError && (
            <p
              role="alert"
              className="text-destructive border-b px-5 py-3 text-sm"
            >
              刷新失败，当前显示上次加载的记录。请点击“刷新记录”重试。
            </p>
          )}
        {audits.isLoading ? (
          <div className="p-5">
            <LoadingBlock rows={6} />
          </div>
        ) : audits.isError && !records.length ? (
          <div className="p-5">
            <ErrorState
              title="审计记录加载失败"
              description={audits.error.message}
              onRetry={() => void audits.refetch()}
            />
          </div>
        ) : !records.length ? (
          <div className="text-muted-foreground space-y-3 p-10 text-center text-sm">
            <p>没有符合当前条件的审计记录</p>
            <Button variant="outline" onClick={reset}>
              重置筛选
            </Button>
          </div>
        ) : (
          <>
            <div className="text-muted-foreground bg-muted/30 hidden grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_20px] gap-4 border-b px-5 py-2 text-xs lg:grid">
              <span>时间</span>
              <span>操作</span>
              <span>操作人</span>
              <span>业务对象</span>
              <span />
            </div>
            <ul className="divide-y">
              {records.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="hover:bg-muted/40 focus-visible:bg-muted/60 grid w-full gap-3 px-5 py-4 text-left outline-offset-[-3px] sm:grid-cols-2 lg:grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_20px] lg:items-center lg:gap-4"
                    onClick={() => setSelected(row)}
                    aria-label={`查看${row.actionLabel}详情，${row.actorName}，${time.format(new Date(row.createdAt))}`}
                  >
                    <time
                      dateTime={row.createdAt}
                      className="text-muted-foreground text-xs leading-6"
                    >
                      {time.format(new Date(row.createdAt))}
                    </time>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {row.actionLabel}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {row.action}
                      </span>
                    </span>
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-sm">
                        {row.actorName}
                      </span>
                      <Badge
                        variant={
                          row.actorType === "SYSTEM_AI" ? "info" : "secondary"
                        }
                      >
                        {actorTypes[row.actorType] ?? row.actorType}
                      </Badge>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {roles[row.actorRole] ?? row.actorRole}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm">
                        {entities[row.entityType] ?? row.entityType}
                      </span>
                      <span className="text-muted-foreground block truncate font-mono text-xs">
                        {row.entityId ?? "未关联单一对象"}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="text-muted-foreground hidden size-4 lg:block"
                    />
                  </button>
                </li>
              ))}
            </ul>
            <div className="space-y-3 border-t p-4 text-center">
              {audits.isFetchNextPageError && (
                <p role="alert" className="text-destructive text-sm">
                  加载更多失败，请重试；已显示的记录已保留。
                </p>
              )}
              {audits.hasNextPage ? (
                <Button
                  variant="outline"
                  disabled={audits.isFetchingNextPage}
                  onClick={() => void audits.fetchNextPage()}
                >
                  {audits.isFetchingNextPage
                    ? "加载中…"
                    : audits.isFetchNextPageError
                      ? "重试加载"
                      : "加载更早的记录"}
                </Button>
              ) : (
                <p className="text-muted-foreground text-xs">
                  已显示当前条件下的全部记录
                </p>
              )}
            </div>
          </>
        )}
      </section>
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <ShieldCheck className="size-3.5 shrink-0" />
        只读查询 · 操作审计默认保留 {AUDIT_LOG_RETENTION_DAYS} 天 ·
        日志记录已写入的操作，不代表所有业务事件都已被审计。
      </p>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selected?.actionLabel ?? "审计详情"}</DialogTitle>
            <DialogDescription>
              核对操作对象、执行身份和已记录的业务详情。
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <LoadingBlock rows={4} />
          ) : detail.isError ? (
            <ErrorState
              title="详情读取失败"
              description={detail.error.message}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            detail.data && (
              <>
                <dl className="bg-muted/20 grid gap-4 rounded-xl border p-4 text-sm sm:grid-cols-2">
                  {[
                    ["操作时间", time.format(new Date(detail.data.createdAt))],
                    [
                      "执行身份",
                      `${detail.data.actorName} · ${actorTypes[detail.data.actorType] ?? detail.data.actorType} · ${roles[detail.data.actorRole] ?? detail.data.actorRole}`,
                    ],
                    ["操作代码", detail.data.action],
                    [
                      "业务类型",
                      entities[detail.data.entityType] ??
                        detail.data.entityType,
                    ],
                    ["对象 ID", detail.data.entityId ?? "未关联单一对象"],
                    ["日志 ID", detail.data.id],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="mt-1 break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                <h3 className="font-semibold">业务详情</h3>
                {entries.length ? (
                  <dl className="divide-y rounded-xl border">
                    {entries.map(([key, value]) => (
                      <div
                        key={String(key)}
                        className="grid gap-2 p-4 sm:grid-cols-[140px_minmax(0,1fr)]"
                      >
                        <dt className="text-muted-foreground text-sm break-all">
                          {fields[String(key)] ?? String(key)}
                        </dt>
                        <dd className="max-h-64 overflow-auto text-sm break-all whitespace-pre-wrap">
                          {detailValue(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    此记录没有附加业务详情。
                  </p>
                )}
                {detail.data.entityId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const next = {
                        ...filters,
                        q: detail.data!.entityId!,
                        entityType: detail.data!.entityType,
                      }
                      setDraft(next)
                      setFilters(next)
                      setSelected(null)
                    }}
                  >
                    查找此对象的相关记录
                  </Button>
                )}
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer text-sm">
                    查看详情结构（敏感凭据字段已隐藏）
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto text-xs break-all whitespace-pre-wrap">
                    {JSON.stringify(detail.data.detail, null, 2)}
                  </pre>
                </details>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
