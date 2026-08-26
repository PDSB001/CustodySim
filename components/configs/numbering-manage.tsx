"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Hash, Save, Shuffle, Waypoints } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

const RuleSchema = z.object({
  id: z.string().optional(),
  docType: z.string(),
  prefix: z.string(),
  dateFormat: z.enum(["NONE", "yyyy", "yyyyMM", "yyyyMMdd"]),
  generationMode: z.enum(["RANDOM", "SEQUENTIAL"]),
  minLength: z.number(),
  randomLength: z.number(),
  currentSeq: z.number(),
})

const dateSamples = {
  NONE: "",
  yyyy: "2026",
  yyyyMM: "202608",
  yyyyMMdd: "20260825",
}
const randomSample = "7KQ2M9ABCDEFGH"

export function NumberingManage() {
  const queryClient = useQueryClient()
  const rule = useQuery({
    queryKey: ["numbering-rule"],
    queryFn: () => requestApi("/api/admin/numbering", RuleSchema),
  })
  const [form, setForm] = useState({
    prefix: "CS",
    dateFormat: "NONE" as keyof typeof dateSamples,
    generationMode: "RANDOM" as "RANDOM" | "SEQUENTIAL",
    minLength: 4,
    randomLength: 6,
  })
  useEffect(() => {
    if (rule.data)
      setForm({
        prefix: rule.data.prefix,
        dateFormat: rule.data.dateFormat,
        generationMode: rule.data.generationMode,
        minLength: rule.data.minLength,
        randomLength: rule.data.randomLength,
      })
  }, [rule.data])

  const save = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/numbering", RuleSchema, {
        method: "PUT",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["numbering-rule"] })
      toast.success("全局编号生成规则已保存")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "保存失败"),
  })

  const preview = `${form.prefix}${dateSamples[form.dateFormat]}${form.generationMode === "RANDOM" ? randomSample.slice(0, form.randomLength) : String((rule.data?.currentSeq ?? 0) + 1).padStart(form.minLength, "0")}`
  const tailLength =
    form.generationMode === "RANDOM" ? form.randomLength : form.minLength

  return (
    <div className="workspace-stack max-w-5xl">
      <PageHeader
        eyebrow="基础资料"
        title="编号生成规则"
        description="设置被监管人员的全局编号策略。自动生成遵循此处规则；单个人员可在“人员编号”中单独修订。"
      />

      <Card className="overflow-hidden">
        <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <p className="text-sm font-semibold text-foreground">
                生成策略
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                随机模式适合作为系统主编号，连续模式仅在需要人工顺序管理时启用。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={form.generationMode === "RANDOM"}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  form.generationMode === "RANDOM"
                    ? "border-brand-500/40 bg-brand-500/[0.04]"
                    : "border-border bg-card hover:border-brand-500/30",
                )}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    generationMode: "RANDOM",
                  }))
                }
              >
                <IconChip icon={Shuffle} tone="brand" />
                <p className="mt-3 text-sm font-semibold text-foreground">
                  安全随机编号
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  使用不易混淆的字母和数字生成，自动检测重复并重试。
                </p>
              </button>
              <button
                type="button"
                aria-pressed={form.generationMode === "SEQUENTIAL"}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  form.generationMode === "SEQUENTIAL"
                    ? "border-brand-500/40 bg-brand-500/[0.04]"
                    : "border-border bg-card hover:border-brand-500/30",
                )}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    generationMode: "SEQUENTIAL",
                  }))
                }
              >
                <IconChip icon={Waypoints} />
                <p className="mt-3 text-sm font-semibold text-foreground">
                  连续流水编号
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  按全局序号递增，适用于必须连续编号的历史迁移场景。
                </p>
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>编号前缀（可留空）</Label>
                <Input
                  value={form.prefix}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      prefix: event.target.value.toUpperCase(),
                    })
                  }
                  placeholder="例如：CS"
                />
              </div>
              <div className="space-y-2">
                <Label>日期片段</Label>
                <Select
                  value={form.dateFormat}
                  onValueChange={(dateFormat) =>
                    setForm({
                      ...form,
                      dateFormat: dateFormat as keyof typeof dateSamples,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">不附加日期</SelectItem>
                    <SelectItem value="yyyy">年份（如：2026）</SelectItem>
                    <SelectItem value="yyyyMM">年月（如：202608）</SelectItem>
                    <SelectItem value="yyyyMMdd">
                      年月日（如：20260825）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {form.generationMode === "RANDOM"
                    ? "随机尾码长度"
                    : "流水号长度"}
                </Label>
                <Input
                  type="number"
                  min={form.generationMode === "RANDOM" ? 4 : 2}
                  max={form.generationMode === "RANDOM" ? 12 : 10}
                  value={tailLength}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setForm(
                      form.generationMode === "RANDOM"
                        ? { ...form, randomLength: value }
                        : { ...form, minLength: value },
                    )
                  }}
                />
              </div>
            </div>

            <Button
              variant="brand"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              <Save />
              {save.isPending ? "保存中…" : "保存全局规则"}
            </Button>
          </div>

          <aside className="space-y-5 border-t border-border p-5 sm:p-6 lg:border-t-0 lg:border-l">
            <div>
              <IconChip icon={Hash} tone="brand" />
              <p className="mt-4 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                下一编号示例
              </p>
              <p className="mt-2 break-all font-mono text-2xl font-bold tracking-[0.04em] text-gradient-brand">
                {preview || "未设置"}
              </p>
            </div>
            <div className="space-y-2.5 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
              <p>
                当前模式：
                <span className="font-semibold text-foreground">
                  {form.generationMode === "RANDOM" ? "安全随机" : "连续流水"}
                </span>
              </p>
              <p>
                {form.generationMode === "RANDOM"
                  ? "随机字符排除易混淆字符 I、O、1、0。"
                  : `当前流水序号：${rule.data?.currentSeq ?? 0}。`}
              </p>
              <p>每次生成与人工改号都会记录至操作审计。</p>
            </div>
          </aside>
        </CardContent>
      </Card>
    </div>
  )
}