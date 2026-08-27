import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import {
  getSupervisionCheckinHistory,
  getSupervisionCheckins,
} from "@/lib/checkin"
import { getSessionUser } from "@/lib/session"
import { legacyDateAllDay } from "@/lib/shanghai-datetime"

const QuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "无监管查看权限", 403)
  try {
    const query = QuerySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    })
    if (
      !query.success ||
      (query.data.date && !legacyDateAllDay(query.data.date))
    )
      return failure("VALIDATION_ERROR", "日期格式不正确", 400)
    return success(
      query.data.date
        ? await getSupervisionCheckinHistory(actor, query.data.date)
        : await getSupervisionCheckins(actor),
    )
  } catch (error) {
    console.error("[API supervision/checkins GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
