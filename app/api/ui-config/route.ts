import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { uiConfigs } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const DEFAULTS: Record<
  string,
  { homeTitle: string; homeSubtitle: string; homeBanner: string }
> = {
  SUPERVISOR: {
    homeTitle: "{name}，当班执勤",
    homeSubtitle: "先批阅任务与补卡，再核对点名记录，落实本班监管事项。",
    homeBanner: "",
  },
  SUPERVISED: {
    homeTitle: "{name}，监室日程",
    homeSubtitle: "按时点名，完成指定任务；留意批阅意见与监所通知。",
    homeBanner: "",
  },
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return failure("UNAUTHORIZED", "请先登录", 401)
  const scope = request.nextUrl.searchParams.get("scope") ?? user.role
  if (!["SUPERVISOR", "SUPERVISED"].includes(scope))
    return failure("VALIDATION_ERROR", "无效的 scope", 400)
  const [config] = await db
    .select()
    .from(uiConfigs)
    .where(eq(uiConfigs.scope, scope))
    .limit(1)
  return success({
    scope,
    homeTitle: config?.homeTitle ?? DEFAULTS[scope].homeTitle,
    homeSubtitle: config?.homeSubtitle ?? DEFAULTS[scope].homeSubtitle,
    homeBanner: config?.homeBanner ?? DEFAULTS[scope].homeBanner,
  })
}
