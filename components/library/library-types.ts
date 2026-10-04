import { z } from "zod"

export const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  format: z.enum(["PDF", "TXT", "DOCX", "EPUB"]),
  enabled: z.boolean(),
  page: z.number(),
  seconds: z.number(),
  coverUrl: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const CatalogSchema = z.object({
  actorRole: z.string().optional(),
  books: z.array(BookSchema),
  totalSeconds: z.number(),
  todaySeconds: z.number().optional(),
  todayPoints: z.number().optional(),
  readingTasks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        readingMinutes: z.number(),
        readingSeconds: z.number(),
        status: z.string(),
      }),
    )
    .optional(),
  scorePolicy: z
    .object({
      enabled: z.boolean(),
      minutesPerPoint: z.number(),
      dailyCap: z.number(),
    })
    .optional(),
})

export type BookInfo = z.infer<typeof BookSchema>
