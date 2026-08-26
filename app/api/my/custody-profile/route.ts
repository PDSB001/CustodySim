import { failure, success } from "@/lib/api-response"
import { getCustodyProfileForUser } from "@/lib/custody-checkin"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看监管档案", 403)
  const profile = await getCustodyProfileForUser(actor.id)
  if (!profile) return failure("NOT_FOUND", "未建立监管档案", 404)
  return success({
    ...profile,
    canCheckin: profile.custodyStatus === "IN_CUSTODY",
    leaveWorkflowEligible: profile.custodyStatus === "IN_CUSTODY",
    geofenceApplicable: profile.custodyStatus === "IN_CUSTODY",
  })
}
