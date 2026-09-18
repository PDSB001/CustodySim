import { failure, success } from "@/lib/api-response"
import { describeLocationReportingPolicy } from "@/lib/location-reporting"
import { GPS_RETENTION_MS } from "@/lib/privacy-retention"
import { getSessionUser } from "@/lib/session"

/**
 * 下发位置上报策略，供 App 在设置页展示并做本地校验。
 *
 * 客户端不应硬编码这些数字：服务端调整区间后，App 无需发版即可跟随。
 */
export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  return success(
    describeLocationReportingPolicy(
      Math.round(GPS_RETENTION_MS / 3_600_000),
    ),
  )
}
