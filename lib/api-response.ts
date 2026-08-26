import { NextResponse } from "next/server"
import { z } from "zod"

export const ErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export function success<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init)
}

export function failure(code: ErrorCode, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status },
  )
}
