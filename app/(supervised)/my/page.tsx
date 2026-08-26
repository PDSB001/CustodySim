import { RoleWorkspaceHome } from "@/components/workspaces/role-workspace"
import { getSessionUser } from "@/lib/session"

export default async function MyPage() {
  const user = await getSessionUser()
  if (!user) return null
  return <RoleWorkspaceHome user={user} kind="SUPERVISED" />
}
