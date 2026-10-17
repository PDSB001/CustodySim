"use client"

import { z } from "@/lib/browser-validation"

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
})

export async function requestApi<T>(
  url: string,
  dataSchema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json")
  const response = await fetch(url, {
    ...init,
    headers,
  })
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    throw new Error(`服务器返回了非 JSON 响应（HTTP ${response.status}）`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const parsed = z
    .object({ success: z.literal(true), data: dataSchema })
    .or(ErrorResponseSchema)
    .safeParse(payload)
  if (!parsed.success) throw new Error("服务器返回的数据格式不正确，请稍后重试")
  if (!parsed.data.success) throw new Error(parsed.data.error.message)
  return parsed.data.data
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  return dateFormatter.format(new Date(value))
}
