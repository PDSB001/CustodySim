"use client"

import { ImagePlus, X } from "lucide-react"
import Image from "next/image"
import { useState } from "react"

import { TASK_IMAGE_MAX_COUNT, normalizeTaskImages } from "@/lib/task-image"
import { compressTaskImage } from "@/lib/task-image-client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * 只读图片展示，值约定与上传控件一致（数组，兼容历史单图字符串）。
 * 用于归档查看这类场景：务必用它渲染图片字段，
 * 否则 base64 会被当作普通文本打印出来。
 */
export function ImageGallery({
  value,
  label,
  emptyText = "（未上传）",
}: {
  value: unknown
  label: string
  emptyText?: string
}) {
  const images = normalizeTaskImages(value)
  if (!images.length)
    return <p className="text-muted-foreground mt-1 text-sm">{emptyText}</p>
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {images.map((image, index) => (
        <Image
          key={`${index}-${image.slice(-12)}`}
          src={image}
          alt={`${label} ${index + 1}`}
          width={640}
          height={480}
          unoptimized
          className="max-h-72 w-full rounded border object-contain"
        />
      ))}
    </div>
  )
}

/**
 * 多图上传控件（任务表单字段、档案表单字段共用）。
 *
 * - 值统一为字符串数组；历史单图（字符串）由 normalizeTaskImages 归一，无需调用方处理
 * - 浏览器端压缩后再写入记录，服务端仍会用 validateTaskImages 复核
 */
export function ImageUploadField({
  label,
  required,
  value,
  onChange,
  disabled,
  hint,
  showLabel = true,
  max,
}: {
  label: string
  required?: boolean
  value: unknown
  onChange: (value: string[]) => void
  disabled?: boolean
  hint?: string
  /** 外层已渲染字段名时（例如档案表单的表格行）设为 false，避免重复出现标签 */
  showLabel?: boolean
  /** 允许的张数上限，默认 3。单图场景（打卡照片、补卡凭证）传 1。 */
  max?: number
}) {
  const images = normalizeTaskImages(value)
  const [error, setError] = useState<string | null>(null)
  const [compressing, setCompressing] = useState(false)
  const limit = max ?? TASK_IMAGE_MAX_COUNT
  const reachedLimit = images.length >= limit

  return (
    <div className="space-y-2">
      {showLabel ? (
        <Label>
          {required ? "* " : ""}
          {label}
        </Label>
      ) : null}
      <label
        className={cn(
          "border-border/70 bg-muted/20 focus-within:border-brand-700/60 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors",
          !(disabled || compressing || reachedLimit) &&
            "hover:border-brand-700/50 hover:bg-muted/40",
          (disabled || compressing || reachedLimit) &&
            "cursor-not-allowed opacity-70",
        )}
      >
        <span className="border-border/70 bg-background flex size-9 shrink-0 items-center justify-center rounded-full border">
          <ImagePlus className="text-brand-700 size-4" />
        </span>
        <span className="min-w-0 text-sm font-medium">
          {compressing
            ? "正在压缩图片…"
            : reachedLimit
              ? `已达 ${limit} 张上限`
              : `点击选择${label}`}
        </span>
        <input
          type="file"
          multiple={limit > 1}
          aria-label={`${label}上传图片`}
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled || compressing || reachedLimit}
          onChange={async (event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            if (!files.length) return
            const room = limit - images.length
            if (room <= 0) return
            setError(null)
            setCompressing(true)
            try {
              const compressed: string[] = []
              for (const file of files.slice(0, room))
                compressed.push(await compressTaskImage(file))
              if (files.length > room)
                setError(
                  `最多 ${limit} 张，已忽略多余的 ${files.length - room} 张`,
                )
              onChange([...images, ...compressed])
            } catch (uploadError) {
              setError(
                uploadError instanceof Error ? uploadError.message : "图片处理失败",
              )
            } finally {
              setCompressing(false)
            }
          }}
        />
      </label>
      <p className="text-muted-foreground text-xs">
        {hint ??
          "支持 JPG、PNG、WebP，原图最大 5 MB，浏览器会压缩到 1 MB 以内再写入记录。"}
        {" "}
        （最多 {limit} 张，已上传 {images.length} 张）
      </p>
      {reachedLimit ? (
        <p className="text-muted-foreground text-xs">
          如需更换，请先移除已上传的图片。
        </p>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {images.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <div
              key={`${index}-${image.slice(-12)}`}
              className="border-border/70 bg-muted/30 relative overflow-hidden rounded-lg border"
            >
              <Image
                src={image}
                alt={`${label}预览 ${index + 1}`}
                width={640}
                height={480}
                unoptimized
                className="h-32 w-full object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`移除第 ${index + 1} 张${label}`}
                className="bg-background/90 absolute top-1.5 right-1.5 size-7 rounded-full p-0 shadow-sm"
                disabled={disabled}
                onClick={() =>
                  onChange(images.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
