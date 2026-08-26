"use client"

import Image from "next/image"
import { RefreshCcw, ShieldAlert } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type SignatureMode = "GENERATED" | "HANDWRITTEN"

export function ProfileSignatureField({
  mode,
  signatureData,
  editable,
  onModeChange,
  onSignatureChange,
}: {
  mode: SignatureMode
  signatureData: string | null
  editable: boolean
  onModeChange: (mode: SignatureMode) => void
  onSignatureChange: (value: string | null) => void
}) {
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const chooseHandwritten = () => {
    if (mode === "HANDWRITTEN") return
    setAcknowledged(false)
    setNoticeOpen(true)
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SignatureModeButton
            active={mode === "GENERATED"}
            disabled={!editable}
            onClick={() => {
              onModeChange("GENERATED")
              onSignatureChange(null)
            }}
          >
            规范签名
          </SignatureModeButton>
          <SignatureModeButton
            active={mode === "HANDWRITTEN"}
            disabled={!editable}
            onClick={chooseHandwritten}
          >
            触屏手写
          </SignatureModeButton>
        </div>
        {mode === "GENERATED" ? (
          <div className="border-border bg-muted/25 relative h-28 max-w-md overflow-hidden rounded-md border">
            {signatureData ? (
              <Image
                src={signatureData}
                alt="规范电子签名"
                fill
                unoptimized
                className="object-contain"
              />
            ) : (
              <p className="text-muted-foreground flex h-full items-center px-4 text-xs leading-5">
                保存后，系统会以当前账户姓名生成规范手写体签名图。
              </p>
            )}
          </div>
        ) : (
          <SignaturePad
            value={signatureData}
            disabled={!editable}
            onChange={onSignatureChange}
          />
        )}
        <p className="text-muted-foreground text-xs leading-5">
          {mode === "HANDWRITTEN"
            ? "手写签名仅以 AES-256-GCM 加密载荷保存；授权查看时才由服务端解密。"
            : "规范签名用于常规确认场景，不采集手写笔迹。"}
        </p>
      </div>
      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}>
        <DialogContent showCloseButton={!editable}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="text-warning size-5" />
              手写签名提示
            </DialogTitle>
            <DialogDescription className="leading-6">
              手写签名属于可识别个人特征的信息，可能被用于确认本人对档案内容的认可。系统会对其加密存储，但无法替代您确认签署意愿的责任。请仅在本人自愿、已核对档案内容后使用。
            </DialogDescription>
          </DialogHeader>
          <label className="border-border bg-muted/30 flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm leading-5">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="accent-brand-600 mt-0.5 size-4 shrink-0"
            />
            我已知悉并自愿使用手写签名。
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoticeOpen(false)}>
              保持规范签名
            </Button>
            <Button
              disabled={!acknowledged}
              onClick={() => {
                onModeChange("HANDWRITTEN")
                onSignatureChange(null)
                setNoticeOpen(false)
              }}
            >
              确认并开始签名
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SignatureModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-brand-500/30 bg-brand-500/10 text-brand-800"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function SignaturePad({
  value,
  disabled,
  onChange,
}: {
  value: string | null
  disabled: boolean
  onChange: (value: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    canvas.width = 960
    canvas.height = 320
    context.scale(2, 2)
    context.clearRect(0, 0, 480, 160)
    context.lineCap = "round"
    context.lineJoin = "round"
    context.lineWidth = 2.4
    context.strokeStyle = "#172554"
    if (!value) return
    const image = new window.Image()
    image.addEventListener("load", () => {
      context.drawImage(image, 0, 0, 480, 160)
    })
    image.src = value
  }, [value])

  const coordinates = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 480,
      y: ((event.clientY - bounds.top) / bounds.height) * 160,
    }
  }
  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    const point = coordinates(event)
    drawingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    context.beginPath()
    context.moveTo(point.x, point.y)
  }
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) return
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    const point = coordinates(event)
    context.lineTo(point.x, point.y)
    context.stroke()
  }
  const finish = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL("image/png"))
  }
  const clear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.clearRect(0, 0, 480, 160)
    onChange(null)
  }

  return (
    <div className="max-w-md space-y-2">
      <div className="border-border bg-muted/20 overflow-hidden rounded-md border">
        <canvas
          ref={canvasRef}
          width={960}
          height={320}
          aria-label="触屏手写签名区域"
          onPointerDown={begin}
          onPointerMove={draw}
          onPointerUp={finish}
          onPointerCancel={finish}
          className={cn(
            "block h-32 w-full touch-none",
            disabled ? "cursor-not-allowed opacity-70" : "cursor-crosshair",
          )}
        />
      </div>
      {!disabled ? (
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <RefreshCcw />
          清除重签
        </Button>
      ) : null}
    </div>
  )
}
