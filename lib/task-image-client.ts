"use client"

import {
  TASK_IMAGE_MAX_BYTES,
  TASK_IMAGE_MAX_ORIGINAL_BYTES,
  validateTaskImageDataUrl,
} from "@/lib/task-image"

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("读取图片失败"))
    reader.readAsDataURL(file)
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("图片无法解析"))
    image.src = source
  })
}

export async function compressTaskImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("仅支持 JPG、PNG 或 WebP 图片")
  if (file.size > TASK_IMAGE_MAX_ORIGINAL_BYTES)
    throw new Error("原始图片不能超过 5 MB")
  const image = await loadImage(await readAsDataUrl(file))
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = Math.min(1, 1_920 / Math.max(1, longestEdge))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("浏览器不支持图片压缩")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const compressed = canvas.toDataURL("image/jpeg", 0.78)
  const error = validateTaskImageDataUrl(compressed)
  if (error || compressed.length > TASK_IMAGE_MAX_BYTES * 1.4)
    throw new Error(error ?? "压缩后的图片不能超过 1 MB")
  return compressed
}
