"use client"

import { AvatarCropper } from "@/components/layout/avatar-cropper"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { compressTaskImage } from "@/lib/task-image-client"

export function AvatarEditor({
  avatar,
  name,
  onClose,
  onSaved,
}: {
  avatar: string | null
  name: string
  onClose: () => void
  onSaved: (avatar: string | null) => void
}) {
  const [draft, setDraft] = useState(avatar)
  const [busy, setBusy] = useState(false)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()
  async function choose(file: File) {
    setBusy(true)
    try {
      const source = await compressTaskImage(file)
      const image = new window.Image()
      image.src = source
      await image.decode()
      setCropImage(image)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取头像失败")
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    setBusy(true)
    try {
      const response = await fetch("/api/me/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: draft }),
      })
      const result = await response.json()
      if (!response.ok || !result.success)
        throw new Error(result.error?.message ?? "保存失败")
      onSaved(result.data.avatar)
      router.refresh()
      toast.success("头像已更新")
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>设置头像</DialogTitle>
          <DialogDescription>
            选择图片后可拖动、缩放裁剪，保存后同步到双端。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-5 py-5">
          {cropImage ? (
            <AvatarCropper
              image={cropImage}
              onCancel={() => setCropImage(null)}
              onConfirm={(value) => {
                setDraft(value)
                setCropImage(null)
              }}
            />
          ) : (
            <>
              <Avatar className="size-28">
                <AvatarImage src={draft ?? undefined} alt="头像预览" />
                <AvatarFallback className="text-3xl">
                  {name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="选择头像图片"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) void choose(file)
                }}
              />
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  选择图片
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || draft === null}
                  onClick={() => setDraft(null)}
                >
                  恢复默认
                </Button>
              </div>
            </>
          )}
        </div>
        {!cropImage && (
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={busy || draft === avatar}
              onClick={() => void save()}
            >
              {busy ? "处理中…" : "保存头像"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
