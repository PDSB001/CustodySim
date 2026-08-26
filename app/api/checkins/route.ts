import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import { CheckinError, doCheckin, getTodayCheckinRecords } from "@/lib/checkin"
import { getSessionUser } from "@/lib/session"

const CheckinSchema = z.object({
  taskId: z.string().uuid(),
  remark: z.string().trim().max(500).optional(),
  location: z
    .object({
      label: z.string().trim().max(200).optional(),
      lat: z.coerce.number().finite().optional(),
      lng: z.coerce.number().finite().optional(),
      accuracy: z.coerce.number().finite().nonnegative().optional(),
    })
    .optional(),
  locationSource: z.enum(["GPS", "IP"]).default("IP"),
})

function checkinFailure(error: unknown) {
  if (error instanceof CheckinError)
    return failure(
      error.status === 403
        ? "FORBIDDEN"
        : error.status === 404
          ? "NOT_FOUND"
          : "VALIDATION_ERROR",
      error.message,
      error.status,
    )
  console.error("[API checkins]", error)
  return failure("INTERNAL_ERROR", "服务器错误", 500)
}

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看个人打卡", 403)
  try {
    return success(await getTodayCheckinRecords(actor.id))
  } catch (error) {
    return checkinFailure(error)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = CheckinSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "打卡参数不合法", 400)
  try {
    const record = await doCheckin({
      user: actor,
      ...parsed.data,
      ip: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    })
    return success(record, { status: 201 })
  } catch (error) {
    return checkinFailure(error)
  }
}
