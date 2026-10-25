import { RoleWorkspaceHome } from "@/components/workspaces/role-workspace"
import { getSessionUser } from "@/lib/session"
import { ProbationBanner } from "@/components/accounts/probation-banner"

export default async function MyPage() {
  const user = await getSessionUser()
  if (!user) return null
  return (
    <div className="space-y-5">
      <ProbationBanner />
      <RoleWorkspaceHome user={user} kind="SUPERVISED" />
    </div>
  )
}
