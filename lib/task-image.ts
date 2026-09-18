export const TASK_IMAGE_MAX_BYTES = 1_000_000
export const TASK_IMAGE_MAX_ORIGINAL_BYTES = 5 * 1024 * 1024
/** 单个图片字段允许的最大张数 */
export const TASK_IMAGE_MAX_COUNT = 3

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
