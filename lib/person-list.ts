import { z } from "zod"

const positiveInteger = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(maximum))

export const PersonListQuerySchema = z.object({
  page: positiveInteger(1_000_000).default(1),
  pageSize: positiveInteger(100).default(25),
  q: z.string().trim().max(100).default(""),
})

export function escapeLikeSearch(value: string) {
  return value.replace(/[\\%_]/g, "\\$&")
}

export function summarizePersonArchives(
  rows: { userId: string; status: string; count: number }[],
) {
  const summaries = new Map<
    string,
    { archiveRecordCount: number; archiveStatus: string }
  >()
  const priority: Record<string, number> = {
    LOCKED: 0,
    DRAFT: 1,
    RETURNED: 2,
    PENDING_REVIEW: 3,
  }
  for (const row of rows) {
    const status = Object.hasOwn(priority, row.status) ? row.status : "DRAFT"
    const summary = summaries.get(row.userId) ?? {
      archiveRecordCount: 0,
      archiveStatus: "LOCKED",
    }
    summary.archiveRecordCount += row.count
    if (priority[status] > priority[summary.archiveStatus])
      summary.archiveStatus = status
    summaries.set(row.userId, summary)
  }
  return summaries
}
