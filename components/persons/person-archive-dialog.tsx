"use client"

import Image from "next/image"
import { Archive, FileText } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { StatusPill, type StatusTone } from "@/components/shared/status-pill"
import { Card, CardContent } from "@/components/ui/card"
import { ProfileImageActions } from "@/components/profile-records/profile-image-actions"
import { CUSTODY_LEVEL_LABELS, type CustodyLevel } from "@/lib/constants"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const FieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
})
const RecordSchema = z.object({
  id: z.string(),
  formName: z.string(),
  status: z.string(),
  code: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  photoData: z.string().nullable(),
  formSnapshot: z.object({ fields: z.array(FieldSchema).default([]) }),
  signatureMode: z.enum(["GENERATED", "HANDWRITTEN"]),
  signatureData: z.string().nullable(),
  officialSealData: z.string().nullable(),
  submittedAt: z.string().nullable(),
  lockedAt: z.string().nullable(),
  boxName: z.string().nullable(),
})
const RecordsSchema = z.array(RecordSchema)

function statusLabel(status: string) {
  return (
    {
      DRAFT: "草稿",
      PENDING_REVIEW: "审核中",
      RETURNED: "已退回",
      LOCKED: "已归档",
    }[status] ?? status
  )
}

function statusTone(status: string): StatusTone {
  if (status === "LOCKED") return "success"
  if (status === "RETURNED") return "warning"
  if (status === "PENDING_REVIEW") return "pending"
  return "neutral"
}

export function PersonArchiveDialog({
  person,
  open,
  onOpenChange,
}: {
  person: {
    id: string
    name: string
    prisonerNumber?: string | null
    customNumber?: string | null
    organizationName?: string | null
    custodyLevel?: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const records = useQuery({
    queryKey: ["person-archive-records", person.id],
    queryFn: () =>
      requestApi(`/api/admin/persons/${person.id}/records`, RecordsSchema),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{person.name}的个人档案</DialogTitle>
        </DialogHeader>
        {records.isLoading ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            正在加载档案…
          </p>
        ) : null}
        {records.data?.map((record) => (
          <Card key={record.id} className="overflow-hidden">
            <CardContent className="space-y-4 p-0">
              <div className="bg-muted/35 border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div>
                  <p className="font-semibold">{record.formName}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {record.code
                      ? `档案编号 ${record.code}`
                      : "尚未生成档案编号"}
                    {record.boxName ? ` · 档案盒 ${record.boxName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusPill tone={statusTone(record.status)}>
                    {statusLabel(record.status)}
                  </StatusPill>
                  <ProfileImageActions
                    compact
                    person={{
                      name: person.name,
                      number: person.prisonerNumber ?? person.customNumber,
                      organization: person.organizationName,
                      custodyLevel: person.custodyLevel
                        ? (CUSTODY_LEVEL_LABELS[
                            person.custodyLevel as CustodyLevel
                          ] ?? person.custodyLevel)
                        : null,
                    }}
                    record={{
                      id: record.id,
                      formName: record.formName,
                      code: record.code,
                      data: record.data,
                      fields: record.formSnapshot.fields,
                      photoData: record.photoData,
                      signatureData: record.signatureData,
                      officialSealData: record.officialSealData,
                    }}
                  />
                </div>
              </div>
              <div className="grid gap-4 px-5 pb-5 sm:grid-cols-[7rem_minmax(0,1fr)]">
                {record.photoData ? (
                  <div className="border-border bg-muted relative size-24 overflow-hidden rounded-md border">
                    <Image
                      src={record.photoData}
                      alt={`${person.name}的档案证件照`}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                ) : null}
                <div
                  className={
                    record.photoData ? "min-w-0" : "min-w-0 sm:col-span-2"
                  }
                >
                  <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                    {record.formSnapshot.fields.map((field) => (
                      <div
                        key={field.name}
                        className={
                          field.type === "TEXTAREA" ||
                          field.type === "COPYWRITE"
                            ? "sm:col-span-2"
                            : ""
                        }
                      >
                        <p className="text-muted-foreground text-xs font-medium">
                          {field.name}
                        </p>
                        <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">
                          {String(record.data[field.name] ?? "（未填写）")}
                        </p>
                      </div>
                    ))}
                  </div>
                  {record.signatureData ? (
                    <div className="border-border bg-muted/20 mt-4 max-w-sm overflow-hidden rounded-md border p-2.5">
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                        {record.signatureMode === "HANDWRITTEN"
                          ? "手写电子签名"
                          : "规范电子签名"}
                      </p>
                      <div className="relative h-20 overflow-hidden rounded bg-white">
                        <Image
                          src={record.signatureData}
                          alt={`${person.name}的电子签名`}
                          fill
                          unoptimized
                          className="object-contain"
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="border-border mt-4 flex min-h-16 items-center gap-3 border-t pt-4">
                    {record.officialSealData ? (
                      <Image
                        src={record.officialSealData}
                        alt="管理处公章"
                        width={76}
                        height={76}
                        unoptimized
                      />
                    ) : null}
                    <p className="text-muted-foreground text-xs">
                      {record.officialSealData
                        ? "管理处公章（最终审批）"
                        : "公章：管理员最终审批后加盖"}
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground border-border border-t px-5 py-3 text-xs">
                {record.lockedAt
                  ? `归档于 ${formatDate(record.lockedAt)}`
                  : record.submittedAt
                    ? `提交于 ${formatDate(record.submittedAt)}`
                    : "尚未提交审核"}
              </p>
            </CardContent>
          </Card>
        ))}
        {!records.isLoading && records.data?.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="尚未填写个人档案"
            description="该人员的账户提交档案后，会在这里集中展示。"
          />
        ) : null}
        {records.isError ? (
          <EmptyState
            icon={FileText}
            title="档案加载失败"
            description="请稍后重试。"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
