import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import {
  getCheckinRecordDetail,
  parseCheckinRecordQuery,
} from "@/lib/checkin-records"
import { getSessionUser } from "@/lib/session"

/**
 * 按人读取打卡明细（监管侧）。
 *
 * `GET /api/supervision/checkins/records?userId=&from=&to=&status=&cursor=&limit=`
 *
 * - 范围：管理员为全部在押人员，监管员为其辖区，被监管人为本人（见 getSupervisedUserIdsForActor）；
 *   不在范围内一律返回空列表，不区分"不存在"与"不可见"。
 * - 分页：游标 `checkinAt|id` 降序，与项目其它列表接口一致。
 * - 地点：GPS 只保留 3 天（lib/privacy-retention.ts），超期后 `locationSource` 为
 *   `GPS_PURGED` 且 `lat/lng` 为空 —— 明细如实下发，由前端提示"已按保留策略清除"。
 */
export async function GET(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)

  const query = parseCheckinRecordQuery(request.nextUrl.searchParams)
  if (!query) return failure("VALIDATION_ERROR", "查询参数不合法", 400)

  try {
    const result = await getCheckinRecordDetail(actor, query)
    return success(result)
  } catch (error) {
    console.error("[API supervision checkins records GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
