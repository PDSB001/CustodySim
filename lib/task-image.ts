export const TASK_IMAGE_MAX_BYTES = 1_000_000
export const TASK_IMAGE_MAX_ORIGINAL_BYTES = 5 * 1024 * 1024

const taskImagePattern = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/

export function getTaskImageDataUrlBytes(value: string) {
  const matched = taskImagePattern.exec(value)
  if (!matched) return null
  const base64 = matched[2]
  if (!base64) return null
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return (base64.length * 3) / 4 - padding
}

export function validateTaskImageDataUrl(value: unknown) {
  if (typeof value !== "string") return "请上传图片"
  const bytes = getTaskImageDataUrlBytes(value)
  if (bytes === null) return "图片格式不合法"
  if (bytes > TASK_IMAGE_MAX_BYTES)
    return "压缩后的图片不能超过 1 MB"
  return null
}
