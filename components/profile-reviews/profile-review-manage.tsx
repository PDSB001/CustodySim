"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, FileCheck2, RotateCcw } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { z } from "zod"

import { requestApi, formatDate } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const FieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
})
const SnapshotSchema = z.object({ fields: z.array(FieldSchema).default([]) })
const ReviewSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  step: z.number(),
  result: z.string(),
  recordStatus: z.string(),
  userName: z.string(),
  formName: z.string(),
  formSnapshot: SnapshotSchema,
  data: z.record(z.string(), z.unknown()),
  signatureMode: z.enum(["GENERATED", "HANDWRITTEN"]),
  signatureData: z.string().nullable(),
  officialSealData: z.string().nullable(),
  submittedAt: z.string().nullable(),
})
const ReviewsSchema = z.array(ReviewSchema)

export function ProfileReviewManage() {
  const client = useQueryClient()
  const [comments, setComments] = useState<Record<string, string>>({})
  const [grades, setGrades] = useState<Record<string, string>>({})
  const reviews = useQuery({
    queryKey: ["profile-reviews"],
    queryFn: () => requestApi("/api/profile-reviews", ReviewsSchema),
  })
  const action = useMutation({
    mutationFn: ({
      id,
      result,
    }: {
      id: string
      result: "APPROVED" | "RETURNED"
    }) =>
      requestApi(`/api/profile-reviews/${id}`, z.object({ id: z.string() }), {
        method: "PATCH",
        body: JSON.stringify({
          result,
          grade: grades[id] ? Number(grades[id]) : null,
          comment: comments[id] || null,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["profile-reviews"] })
      toast.success("档案会签已处理")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "处理失败"),
  })
  const pending =
    reviews.data?.filter((review) => review.result === "PENDING") ?? []
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="档案管理"
        title="档案审核"
        description="已配置监管关系的档案先由监管人会签，再流转至管理处；未配置时直接进入管理处审核。审核通过后，系统锁定记录并生成档案编号。"
      />
      {pending.map((review) => (
        <Card key={review.id} className="surface-panel--interactive">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>
                  {review.formName} · {review.userName}
                </CardTitle>
                <p className="text-muted-foreground mt-2 text-xs">
                  第 {review.step + 1} 环会签 · 提交于{" "}
                  {formatDate(review.submittedAt)}
                </p>
              </div>
              <StatusPill tone="pending">待你会签</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="bg-muted/50 grid gap-3 rounded-lg p-3 sm:grid-cols-2">
              {review.formSnapshot.fields.map((field) => (
                <div
                  key={field.name}
                  className={
                    field.type === "TEXTAREA" || field.type === "COPYWRITE"
                      ? "sm:col-span-2"
                      : ""
                  }
                >
                  <p className="text-muted-foreground text-xs font-semibold">
                    {field.name}
                  </p>
                  <p className="text-foreground mt-1 text-sm leading-6 whitespace-pre-wrap">
                    {String(review.data[field.name] ?? "（未填写）")}
                  </p>
                </div>
              ))}
            </div>
            {review.signatureData ? (
              <div className="border-border bg-muted/20 max-w-md overflow-hidden rounded-lg border p-3">
                <p className="text-muted-foreground mb-2 text-xs font-semibold">
                  {review.signatureMode === "HANDWRITTEN"
                    ? "手写电子签名"
                    : "规范电子签名"}
                </p>
                <div className="relative h-24 overflow-hidden rounded-md bg-white">
                  <Image
                    src={review.signatureData}
                    alt={`${review.userName}的电子签名`}
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
              </div>
            ) : null}
            {review.officialSealData ? (
              <div className="border-border bg-muted/20 flex w-fit items-center gap-3 rounded-lg border p-3">
                <Image
                  src={review.officialSealData}
                  alt="管理处公章"
                  width={88}
                  height={88}
                  unoptimized
                />
                <p className="text-muted-foreground text-xs">管理处公章</p>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>评分（可选）</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={grades[review.id] ?? ""}
                  onChange={(event) =>
                    setGrades((current) => ({
                      ...current,
                      [review.id]: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>会签意见</Label>
                <Textarea
                  value={comments[review.id] ?? ""}
                  onChange={(event) =>
                    setComments((current) => ({
                      ...current,
                      [review.id]: event.target.value,
                    }))
                  }
                  placeholder="填写审核意见（可选）"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ id: review.id, result: "APPROVED" })
                }
              >
                <CheckCircle2 />
                通过会签
              </Button>
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ id: review.id, result: "RETURNED" })
                }
              >
                <RotateCcw />
                退回修改
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {pending.length === 0 ? (
        <div className="surface-panel">
          <EmptyState
            icon={FileCheck2}
            title="暂无待处理档案会签"
            description="被监管人提交档案且轮到你处理时，会显示在这里。"
          />
        </div>
      ) : null}
    </div>
  )
}
