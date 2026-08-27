"use client"

import { Camera, Save, Send, X } from "lucide-react"
import Image from "next/image"
import { Fragment, useEffect, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker, MonthPicker } from "@/components/ui/date-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { ProfileSignatureField } from "@/components/profile-records/profile-signature-field"
import {
  applyComputedProfileAge,
  calculateAgeFromBirthMonth,
  hasComputedProfileAge,
} from "@/lib/profile-age"

export const ProfileFieldSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "SELECT", "DATE", "COPYWRITE"]),
  required: z.boolean(),
  options: z.array(z.string()),
})

const SaveResult = z.object({ id: z.string(), status: z.string() })

export function ProfileRecordEditor({
  form,
  record,
  onSaved,
}: {
  form: {
    id: string
    name: string
    content: string | null
    fields: z.infer<typeof ProfileFieldSchema>[]
  }
  record?: {
    id: string
    status: string
    data: Record<string, unknown>
    photoData: string | null
    signatureMode: "GENERATED" | "HANDWRITTEN"
    signatureData: string | null
    officialSealData: string | null
  } | null
  onSaved: () => void
}) {
  const [data, setData] = useState<Record<string, unknown>>(() =>
    applyComputedProfileAge(record?.data ?? {}, form.fields),
  )
  const [photoData, setPhotoData] = useState<string | null>(
    record?.photoData ?? null,
  )
  const [signatureMode, setSignatureMode] = useState<
    "GENERATED" | "HANDWRITTEN"
  >(record?.signatureMode ?? "GENERATED")
  const [handwrittenSignatureData, setHandwrittenSignatureData] = useState<
    string | null
  >(record?.signatureMode === "HANDWRITTEN" ? record.signatureData : null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setData(applyComputedProfileAge(record?.data ?? {}, form.fields))
    setPhotoData(record?.photoData ?? null)
    setSignatureMode(record?.signatureMode ?? "GENERATED")
    setHandwrittenSignatureData(
      record?.signatureMode === "HANDWRITTEN" ? record.signatureData : null,
    )
  }, [record, form.id, form.fields])

  const editable = !record || ["DRAFT", "RETURNED"].includes(record.status)
  const ageIsComputed = hasComputedProfileAge(form.fields)
  const computedAge = calculateAgeFromBirthMonth(data["出生年月"])
  const fieldsInDisplayOrder = [...form.fields]
  const ageIndex = fieldsInDisplayOrder.findIndex(
    (field) => field.name === "年龄",
  )
  const birthMonthIndex = fieldsInDisplayOrder.findIndex(
    (field) => field.name === "出生年月",
  )
  if (
    ageIsComputed &&
    ageIndex >= 0 &&
    birthMonthIndex >= 0 &&
    ageIndex < birthMonthIndex
  ) {
    const ageField = fieldsInDisplayOrder[ageIndex]
    const birthMonthField = fieldsInDisplayOrder[birthMonthIndex]
    fieldsInDisplayOrder[ageIndex] = birthMonthField
    fieldsInDisplayOrder[birthMonthIndex] = ageField
  }
  const save = async (submit: boolean) => {
    setSaving(true)
    try {
      const saved = await requestApi("/api/profile-records", SaveResult, {
        method: "POST",
        body: JSON.stringify({
          formId: form.id,
          data,
          photoData,
          signatureMode,
          handwrittenSignatureData:
            signatureMode === "HANDWRITTEN" ? handwrittenSignatureData : null,
        }),
      })
      if (submit)
        await requestApi("/api/profile-records/submit", SaveResult, {
          method: "POST",
          body: JSON.stringify({ recordId: saved.id }),
        })
      toast.success(submit ? "档案已提交会签" : "草稿已保存")
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const selectPhoto = (file: File | undefined) => {
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("请上传 JPEG、PNG 或 WebP 格式的照片")
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("照片不能超过 2MB")
      return
    }
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setPhotoData(reader.result)
    })
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-5">
      {form.content ? (
        <p className="bg-muted/60 text-muted-foreground rounded-lg px-3.5 py-3 text-sm leading-6">
          {form.content}
        </p>
      ) : null}
      <div className="border-border/80 bg-card overflow-hidden rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <tbody className="divide-border/70 divide-y">
            <tr className="align-top">
              <th className="bg-muted/45 border-border/70 text-muted-foreground w-28 border-r px-3 py-3 text-left text-xs font-semibold sm:w-36">
                证件照
                <span className="mt-0.5 block font-normal">选填</span>
              </th>
              <td className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  {photoData ? (
                    <div className="border-border bg-muted relative size-24 overflow-hidden rounded-md border">
                      <Image
                        src={photoData}
                        alt="档案证件照"
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="text-muted-foreground border-border bg-muted/30 flex size-24 items-center justify-center rounded-md border border-dashed">
                      <Camera className="size-5" />
                    </div>
                  )}
                  {editable ? (
                    <div className="flex flex-wrap gap-2">
                      <Label className="border-border bg-background hover:bg-muted inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors">
                        <Camera className="size-4" />
                        {photoData ? "更换照片" : "上传照片"}
                        <Input
                          className="sr-only"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(event) =>
                            selectPhoto(event.target.files?.[0])
                          }
                        />
                      </Label>
                      {photoData ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPhotoData(null)}
                        >
                          <X />
                          移除
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-muted-foreground w-full text-xs sm:w-auto">
                    JPEG、PNG 或 WebP，最大 2MB
                  </p>
                </div>
              </td>
            </tr>
            {fieldsInDisplayOrder.map((field) => {
              if (field.name === "罩杯" && data["性别"] !== "女") return null
              return (
                <Fragment key={field.name}>
                  {field.name === "身高（cm）" ? (
                    <tr>
                      <th
                        colSpan={2}
                        className="bg-brand-500/8 text-brand-800 border-border/70 border-y px-3 py-2 text-left text-xs font-semibold tracking-wide"
                      >
                        体态特征
                        <span className="text-muted-foreground ml-2 font-normal">
                          选填，可按实际情况补充
                        </span>
                      </th>
                    </tr>
                  ) : null}
                  <tr className="align-top">
                    <th className="bg-muted/45 border-border/70 text-muted-foreground w-28 border-r px-3 py-3 text-left text-xs font-semibold sm:w-36">
                      {field.required &&
                      !(field.name === "年龄" && ageIsComputed) ? (
                        <span className="text-destructive">* </span>
                      ) : null}
                      {field.name}
                    </th>
                    <td className="p-3">
                      {field.type === "COPYWRITE" ? (
                        <div className="space-y-2">
                          <p className="bg-muted/60 text-muted-foreground rounded-md px-3 py-2 text-sm leading-6">
                            {field.options[0] || "此字段未设置抄写原文"}
                          </p>
                          <Textarea
                            disabled={!editable}
                            value={String(data[field.name] ?? "")}
                            onChange={(event) =>
                              setData((current) => ({
                                ...current,
                                [field.name]: event.target.value,
                              }))
                            }
                            placeholder="请逐字抄写上方内容"
                          />
                        </div>
                      ) : field.type === "TEXTAREA" ? (
                        <Textarea
                          disabled={!editable}
                          value={String(data[field.name] ?? "")}
                          onChange={(event) =>
                            setData((current) => ({
                              ...current,
                              [field.name]: event.target.value,
                            }))
                          }
                        />
                      ) : field.type === "SELECT" ? (
                        <Select
                          disabled={!editable}
                          value={String(data[field.name] ?? "")}
                          onValueChange={(value) =>
                            setData((current) => {
                              const nextValue =
                                value === "__none__" ? "" : value
                              return field.name === "性别" && nextValue !== "女"
                                ? { ...current, 性别: nextValue, 罩杯: "" }
                                : { ...current, [field.name]: nextValue }
                            })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="请选择" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">请选择</SelectItem>
                            {field.options.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : field.name === "年龄" && ageIsComputed ? (
                        <div className="space-y-1.5">
                          <Input
                            readOnly
                            aria-label="年龄（由出生年月自动计算）"
                            value={
                              computedAge === null ? "" : String(computedAge)
                            }
                            placeholder="请先选择出生年月"
                          />
                          <p className="text-muted-foreground text-xs">
                            根据出生年月自动计算，无需填写
                          </p>
                        </div>
                      ) : field.name === "出生年月" ? (
                        <MonthPicker
                          disabled={!editable}
                          value={String(data[field.name] ?? "")}
                          onValueChange={(value) =>
                            setData((current) =>
                              applyComputedProfileAge(
                                { ...current, [field.name]: value },
                                form.fields,
                              ),
                            )
                          }
                        />
                      ) : field.type === "DATE" ? (
                        <DatePicker
                          ariaLabel={field.name}
                          disabled={!editable}
                          value={String(data[field.name] ?? "")}
                          onValueChange={(value) =>
                            setData((current) => ({
                              ...current,
                              [field.name]: value,
                            }))
                          }
                        />
                      ) : (
                        <Input
                          disabled={!editable}
                          type={field.type === "NUMBER" ? "number" : "text"}
                          min={field.name === "出生日" ? 1 : undefined}
                          max={field.name === "出生日" ? 31 : undefined}
                          step={field.name === "出生日" ? 1 : undefined}
                          value={String(data[field.name] ?? "")}
                          onChange={(event) =>
                            setData((current) => {
                              const value = event.target.value
                              if (field.name !== "出生日" || value === "")
                                return { ...current, [field.name]: value }
                              const day = Number(value)
                              return day >= 1 && day <= 31
                                ? { ...current, [field.name]: value }
                                : current
                            })
                          }
                        />
                      )}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
            <tr className="align-top">
              <th className="bg-muted/45 border-border/70 text-muted-foreground w-28 border-r px-3 py-3 text-left text-xs font-semibold sm:w-36">
                电子签名
                <span className="mt-0.5 block font-normal">默认生成</span>
              </th>
              <td className="p-3">
                <ProfileSignatureField
                  mode={signatureMode}
                  signatureData={
                    signatureMode === "HANDWRITTEN"
                      ? handwrittenSignatureData
                      : (record?.signatureData ?? null)
                  }
                  editable={editable}
                  onModeChange={setSignatureMode}
                  onSignatureChange={setHandwrittenSignatureData}
                />
              </td>
            </tr>
            <tr className="align-top">
              <th className="bg-muted/45 border-border/70 text-muted-foreground w-28 border-r px-3 py-3 text-left text-xs font-semibold sm:w-36">
                公章
                <span className="mt-0.5 block font-normal">管理员加盖</span>
              </th>
              <td className="p-3">
                {record?.officialSealData ? (
                  <div className="border-border bg-muted/20 flex w-fit items-center gap-3 rounded-md border p-2.5">
                    <Image
                      src={record.officialSealData}
                      alt="管理处公章"
                      width={92}
                      height={92}
                      unoptimized
                    />
                    <p className="text-muted-foreground text-xs leading-5">
                      管理处最终审批后加盖
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    管理处最终审批后加盖公章
                  </p>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => save(false)}
          >
            <Save />
            保存草稿
          </Button>
          <Button disabled={saving} onClick={() => save(true)}>
            <Send />
            保存并提交会签
          </Button>
        </div>
      ) : (
        <p className="bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 text-sm">
          此档案已进入会签或归档流程，暂不可修改。
        </p>
      )}
    </div>
  )
}
