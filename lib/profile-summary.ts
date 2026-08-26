export const PROFILE_SUMMARY_ARCHIVE_BINDINGS = {
  chargeName: ["罪名", "所犯罪名", "罪名及量刑"],
  sentenceStartDate: ["刑期起始", "刑期起始日期", "刑期开始日期", "刑期开始"],
  sentenceEndDate: ["刑期截止", "刑期截止日期", "刑期结束日期", "刑期结束"],
} as const

type SummaryField = keyof typeof PROFILE_SUMMARY_ARCHIVE_BINDINGS
type SummarySource = "PERSON" | "ARCHIVE" | "NONE"
type ArchiveRecord = { data: unknown }

function archiveValue(records: ArchiveRecord[], field: SummaryField) {
  const aliases = new Set<string>(PROFILE_SUMMARY_ARCHIVE_BINDINGS[field])
  for (const record of records) {
    if (!record.data || typeof record.data !== "object") continue
    for (const [name, value] of Object.entries(record.data)) {
      if (!aliases.has(name) || typeof value !== "string" || !value.trim())
        continue
      return value.trim()
    }
  }
  return null
}

function resolveField(
  value: string | null,
  records: ArchiveRecord[],
  field: SummaryField,
) {
  if (value) return { value, source: "PERSON" as const }
  const linkedValue = archiveValue(records, field)
  return {
    value: linkedValue,
    source: linkedValue ? ("ARCHIVE" as const) : ("NONE" as const),
  }
}

export function resolveProfileSummary({
  chargeName,
  sentenceStartDate,
  sentenceEndDate,
  archiveRecords,
}: {
  chargeName: string | null
  sentenceStartDate: string | null
  sentenceEndDate: string | null
  archiveRecords: ArchiveRecord[]
}) {
  return {
    chargeName: resolveField(chargeName, archiveRecords, "chargeName"),
    sentenceStartDate: resolveField(
      sentenceStartDate,
      archiveRecords,
      "sentenceStartDate",
    ),
    sentenceEndDate: resolveField(
      sentenceEndDate,
      archiveRecords,
      "sentenceEndDate",
    ),
  }
}

export type ProfileSummarySource = SummarySource
