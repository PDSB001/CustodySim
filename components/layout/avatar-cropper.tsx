"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

export function AvatarCropper({
  image,
  onCancel,
  onConfirm,
}: {
  image: HTMLImageElement
  onCancel: () => void
  onConfirm: (value: string) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({
    x: image.naturalWidth / 2,
    y: image.naturalHeight / 2,
  })
  const side = Math.min(image.naturalWidth, image.naturalHeight) / zoom
  const left = Math.max(
    0,
    Math.min(image.naturalWidth - side, center.x - side / 2),
  )
  const top = Math.max(
    0,
    Math.min(image.naturalHeight - side, center.y - side / 2),
  )
  function move(x: number, y: number) {
    setCenter({
      x: Math.max(
        side / 2,
        Math.min(image.naturalWidth - side / 2, left + side / 2 + x),
      ),
      y: Math.max(
        side / 2,
        Math.min(image.naturalHeight - side / 2, top + side / 2 + y),
      ),
    })
  }
  useEffect(() => {
    const context = canvas.current?.getContext("2d")
    if (!context) return
    context.fillStyle = "white"
    context.fillRect(0, 0, 384, 384)
    context.drawImage(image, left, top, side, side, 0, 0, 384, 384)
  }, [image, left, top, side])
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <canvas
        ref={canvas}
        width={384}
        height={384}
        tabIndex={0}
        role="img"
        aria-label="头像裁剪预览，可拖动或使用方向键调整位置"
        className="border-border size-60 max-w-full cursor-move touch-none rounded-full border focus-visible:outline-2 focus-visible:outline-offset-4"
        onPointerDown={(event) => {
          if (drag.current) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          }
        }}
        onPointerMove={(event) => {
          const previous = drag.current
          if (!previous || previous.id !== event.pointerId) return
          const ratio = side / event.currentTarget.getBoundingClientRect().width
          move(
            (previous.x - event.clientX) * ratio,
            (previous.y - event.clientY) * ratio,
          )
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          }
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(event) => {
          const step = side / 30
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }
          const direction = directions[event.key]
          if (direction) {
            event.preventDefault()
            move(...direction)
          }
        }}
      />
      <label className="flex w-full items-center gap-3 text-sm">
        缩放
        <input
          aria-label="头像缩放"
          className="min-w-0 flex-1"
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <span>{zoom.toFixed(1)}×</span>
      </label>
      <p className="text-muted-foreground text-xs">
        拖动图片调整位置，也可用方向键微调。
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setZoom(1)
            setCenter({ x: image.naturalWidth / 2, y: image.naturalHeight / 2 })
          }}
        >
          重置
        </Button>
        <Button variant="outline" onClick={onCancel}>
          取消裁剪
        </Button>
        <Button
          onClick={() => {
            const output = document.createElement("canvas")
            output.width = output.height = 192
            const context = output.getContext("2d")
            if (!context) return
            context.fillStyle = "white"
            context.fillRect(0, 0, 192, 192)
            context.drawImage(image, left, top, side, side, 0, 0, 192, 192)
            onConfirm(output.toDataURL("image/jpeg", 0.8))
          }}
        >
          使用此裁剪
        </Button>
      </div>
    </div>
  )
}
