import { z } from "zod"

export const MakeupReviewTraceSchema = z.object({
  autoReviewReason: z.string().nullable().optional(),
  autoReviewHistory: z
    .array(
      z.object({
        id: z.string(),
        status: z.string(),
        result: z.string().nullable(),
        reason: z.string().nullable(),
        model: z.string(),
        createdAt: z.string(),
        isCurrent: z.boolean(),
      }),
    )
    .default([]),
  reviewHistory: z
    .array(
      z.object({
        id: z.string(),
        actorName: z.string(),
        actorType: z.string(),
        result: z.string(),
        comment: z.string().nullable(),
        createdAt: z.string(),
        isCurrent: z.boolean(),
      }),
    )
    .default([]),
})
