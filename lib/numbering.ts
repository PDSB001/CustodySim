export function formatDatePart(date: Date, format: string) {
  if (format === "NONE") return ""
  const values = {
    yyyy: String(date.getFullYear()),
    yy: String(date.getFullYear()).slice(-2),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    dd: String(date.getDate()).padStart(2, "0"),
  }
  return format.replace(
    /yyyy|yy|MM|dd/g,
    (token) => values[token as keyof typeof values],
  )
}

const RANDOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function buildRandomCode({
  prefix,
  date = new Date(),
  dateFormat = "NONE",
  randomLength = 6,
}: {
  prefix: string
  date?: Date
  dateFormat?: string
  randomLength?: number
}) {
  const values = new Uint32Array(randomLength)
  crypto.getRandomValues(values)
  const suffix = Array.from(
    values,
    (value) => RANDOM_ALPHABET[value % RANDOM_ALPHABET.length],
  ).join("")
  return `${prefix}${formatDatePart(date, dateFormat)}${suffix}`
}

export function buildCode({
  prefix,
  date = new Date(),
  dateFormat = "yyyyMM",
  sequence,
  minLength = 4,
}: {
  prefix: string
  date?: Date
  dateFormat?: string
  sequence: number
  minLength?: number
}) {
  return `${prefix}${formatDatePart(date, dateFormat)}${String(sequence).padStart(minLength, "0")}`
}

const DATE_PART_LENGTHS: Record<string, number> = {
  NONE: 0,
  yyyy: 4,
  yyyyMM: 6,
  yyyyMMdd: 8,
}

export function extractSequentialCodeNumber({
  code,
  prefix,
  dateFormat,
  minLength,
}: {
  code: string
  prefix: string
  dateFormat: string
  minLength: number
}) {
  if (!code.startsWith(prefix)) return null
  const suffix = code.slice(prefix.length + (DATE_PART_LENGTHS[dateFormat] ?? 0))
  if (suffix.length < minLength || !/^\d+$/.test(suffix)) return null
  const sequence = Number(suffix)
  return Number.isSafeInteger(sequence) ? sequence : null
}

export function getHighestSequentialCodeNumber({
  codes,
  prefix,
  dateFormat,
  minLength,
}: {
  codes: string[]
  prefix: string
  dateFormat: string
  minLength: number
}) {
  return codes.reduce((highest, code) => {
    const sequence = extractSequentialCodeNumber({
      code,
      prefix,
      dateFormat,
      minLength,
    })
    return sequence === null ? highest : Math.max(highest, sequence)
  }, 0)
}
