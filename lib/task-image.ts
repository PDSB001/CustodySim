export const TASK_IMAGE_MAX_BYTES = 1_000_000
export const TASK_IMAGE_MAX_ORIGINAL_BYTES = 5 * 1024 * 1024
/** 单个图片字段允许的最大张数 */
export const TASK_IMAGE_MAX_COUNT = 3

const taskImagePattern =
  /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/

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
  if (bytes > TASK_IMAGE_MAX_BYTES) return "压缩后的图片不能超过 1 MB"
  return null
}

/**
 * 解析后的图片：MIME 类型与原始字节。
 *
 * 字节明确标注为由 `ArrayBuffer` 支撑：这样可以直接作为 `Response` 的 body
 * （`BodyInit` 不接受 `ArrayBufferLike` 背后可能共享的视图）。
 */
export type TaskImageData = { mimeType: string; bytes: Uint8Array<ArrayBuffer> }

/**
 * 解析图片 data URL，返回 MIME 与真实字节（独立图片端点需要可下发的字节流）。
 *
 * 与 `getTaskImageDataUrlBytes` 共用同一个正则：后者只按 base64 长度估算体积、
 * 不会为了校验去解码 1 MB，这里才真正解码，避免"校验通过却下发不出来"。
 */
export function parseTaskImageDataUrl(value: string): TaskImageData | null {
  const matched = taskImagePattern.exec(value)
  if (!matched) return null
  const extension = matched[1]
  const base64 = matched[2]
  if (!extension || !base64) return null
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index)
    return { mimeType: `image/${extension}`, bytes }
  } catch {
    // 正则只约束字符集：长度不是 4 的倍数等情况 atob 仍会抛错，按格式不合法处理。
    return null
  }
}

/**
 * 把一个图片字段的值统一成数组。
 *
 * 兼容历史数据：早期一个字段只能传一张，存的是字符串；
 * 现在统一支持多张，因此读取、校验、渲染一律先经过本函数归一。
 */
export function normalizeTaskImages(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : []
  if (Array.isArray(value))
    return value.filter(
      (item): item is string => typeof item === "string" && item !== "",
    )
  return []
}

/**
 * 校验图片字段的值，接受单个字符串（历史数据）或字符串数组。
 * 返回错误文案；null 表示通过。
 */
export function validateTaskImages(value: unknown) {
  const images = normalizeTaskImages(value)
  if (!images.length) return "请上传图片"
  if (images.length > TASK_IMAGE_MAX_COUNT)
    return `最多上传 ${TASK_IMAGE_MAX_COUNT} 张图片`
  for (const image of images) {
    const error = validateTaskImageDataUrl(image)
    if (error) return error
  }
  return null
}
