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
    homeTitle: "你好，{name}",
    homeSubtitle: "集中处理今日任务、打卡异常、补卡审核与执行汇报。",
    homeBanner: "",
  },
  SUPERVISED: {
    homeTitle: "你好，{name}",
    homeSubtitle: "查看今天需要完成的任务、打卡时段与通知，所有操作从这里开始。",
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