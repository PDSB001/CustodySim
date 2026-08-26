"use client"

import { z } from "zod"

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
})

export async function requestApi<T>(
  url: string,
  dataSchema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const payload: unknown = await response.json()
  const parsed = z
    .object({ success: z.literal(true), data: dataSchema })
    .or(ErrorResponseSchema)
    .parse(payload)
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
