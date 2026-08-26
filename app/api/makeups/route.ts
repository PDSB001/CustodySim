import { desc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import {
  CheckinError,
  createCheckinMakeup,
  getCheckinReviewQueue,
} from "@/lib/checkin"
import { db } from "@/lib/db"
import { checkinMakeups, rules } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const MakeupSchema = z.object({
  taskId: z.string().uuid(),
  reason: z.string().trim().min(2, "请说明补卡原因").max(1000),
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

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    if (actor.role !== "SUPERVISED")
      return success(await getCheckinReviewQueue(actor))
    const rows = await db
      .select({
        id: checkinMakeups.id,
        taskId: checkinMakeups.taskId,
        ruleName: rules.name,
        reason: checkinMakeups.reason,
        status: checkinMakeups.status,
        reviewComment: checkinMakeups.reviewComment,
        createdAt: checkinMakeups.createdAt,
      })
      .from(checkinMakeups)
      .innerJoin(rules, eq(rules.id, checkinMakeups.ruleId))
      .where(eq(checkinMakeups.userId, actor.id))
      .orderBy(desc(checkinMakeups.createdAt))
    return success(rows)
  } catch (error) {
    console.error("[API makeups GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = MakeupSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "补卡申请参数不合法", 400)
  try {
    const makeup = await createCheckinMakeup({
      user: actor,
      ...parsed.data,
      ip: getRequestIp(request.headers),
    })
    return success(makeup, { status: 201 })
  } catch (error) {
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
    console.error("[API makeups POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
