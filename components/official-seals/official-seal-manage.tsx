"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Image from "next/image"
import { Save, Stamp } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import {
  OFFICIAL_SEAL_KIND_LABELS,
  OFFICIAL_SEAL_KINDS,
  type OfficialSealKind,
} from "@/lib/official-seal"
import { generateOfficialSealData } from "@/lib/official-seal-image"

const SealSchema = z.object({
  id: z.string().nullable(),
  kind: z.enum(OFFICIAL_SEAL_KINDS),
  organizationName: z.string(),
  sealText: z.string(),
  active: z.boolean(),
})
const SealsSchema = z.array(SealSchema)

export function OfficialSealManage() {
  const client = useQueryClient()
  const seals = useQuery({
    queryKey: ["official-seals"],
    queryFn: () => requestApi("/api/admin/official-seals", SealsSchema),
  })
  const [forms, setForms] = useState<Record<string, z.infer<typeof SealSchema>>>({})
  useEffect(() => {
    if (!seals.data) return
    setForms(Object.fromEntries(seals.data.map((seal) => [seal.kind, seal])))
  }, [seals.data])
  const save = useMutation({
    mutationFn: (kind: OfficialSealKind) =>
      requestApi("/api/admin/official-seals", SealSchema, {
        method: "PUT",
        body: JSON.stringify(forms[kind]),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["official-seals"] })
      toast.success("印章配置已保存，后续审批将使用新印章")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "保存印章失败"),
  })
  return (
    <div className="workspace-stack mx-auto max-w-6xl">
      <PageHeader
        eyebrow="系统管理"
        title="印章中心"
        description="各类印章独立配置。审批完成后会把当时的印章图像写入记录，历史记录不会受后续修改影响。"
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {OFFICIAL_SEAL_KINDS.map((kind) => {
          const form = forms[kind]
          if (!form) return null
          const preview = generateOfficialSealData({
            kind,
            organizationName: form.organizationName,
            sealText: form.sealText,
          })
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stamp className="size-4" />
                  {OFFICIAL_SEAL_KIND_LABELS[kind]}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>机构名称</Label>
                    <Input value={form.organizationName} onChange={(event) => setForms((current) => ({ ...current, [kind]: { ...form, organizationName: event.target.value } }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>印章用途文字</Label>
                    <Input value={form.sealText} onChange={(event) => setForms((current) => ({ ...current, [kind]: { ...form, sealText: event.target.value } }))} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.active} onChange={(event) => setForms((current) => ({ ...current, [kind]: { ...form, active: event.target.checked } }))} />
                    启用此专用章
                  </label>
                  <Button disabled={save.isPending} onClick={() => save.mutate(kind)}><Save />保存{OFFICIAL_SEAL_KIND_LABELS[kind]}</Button>
                </div>
                <div className="border-border bg-muted/30 flex items-center justify-center rounded-lg border p-3">
                  <Image src={preview} alt={`${OFFICIAL_SEAL_KIND_LABELS[kind]}预览`} width={180} height={180} unoptimized className="size-44 object-contain" />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
