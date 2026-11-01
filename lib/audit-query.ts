import { z } from "zod"

const date = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value),
    "日期不合法",
  )
export const AuditQuerySchema = z
  .object({
    q: z.string().trim().max(120).default(""),
    actorType: z.enum(["", "USER", "SYSTEM_AI", "SYSTEM"]).default(""),
    action: z.string().trim().max(80).default(""),
    entityType: z.string().trim().max(80).default(""),
    from: date.default(""),
    to: date.default(""),
    cursor: z.string().max(128).default(""),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "开始日期不能晚于结束日期",
  )

export function parseAuditCursor(cursor: string) {
  if (!cursor) return null
  const parts = cursor.split("|")
  if (
    parts.length !== 2 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(parts[0]!) ||
    !Number.isFinite(Date.parse(parts[0]!)) ||
    new Date(parts[0]!).toISOString().slice(0, 19) !== parts[0]!.slice(0, 19) ||
    !z.uuid().safeParse(parts[1]).success
  )
    throw new Error("分页游标不合法，请刷新后重试")
  return { time: parts[0]!, id: parts[1]! }
}

export function auditLikePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

export function redactAuditDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditDetail)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|passphrase|secret|token|authorization|cookie|totp|recovery.?codes?|credential|private.?key|api.?key|access.?key/i.test(
          key,
        )
          ? "[已隐藏敏感凭据]"
          : redactAuditDetail(item),
      ]),
    )
  return value
}
