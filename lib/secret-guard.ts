/**
 * 密钥校验：既检查长度，也拒绝 .env.example 里的示例占位值。
 *
 * 占位值同样满足“至少 32 字符”的长度要求，若不显式拒绝，
 * 直接复制 .env.example 的部署会静默使用公开可预测的密钥。
 */
const PLACEHOLDER_MARKERS = [
  "replace-this",
  "replace_this",
  "changeme",
  "change-me",
  "change_me",
  "your-secret",
  "your_secret",
  "placeholder",
  "example",
] as const

export function isPlaceholderSecret(value: string) {
  const normalized = value.trim().toLowerCase()
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
}

export function assertUsableSecret(
  name: string,
  value: string | undefined,
  minLength = 32,
) {
  if (!value || value.length < minLength)
    throw new Error(`${name} 至少需要 ${minLength} 个字符`)
  if (isPlaceholderSecret(value))
    throw new Error(
      `${name} 仍是示例占位值，请为当前环境生成独立的随机密钥`,
    )
  return value
}
