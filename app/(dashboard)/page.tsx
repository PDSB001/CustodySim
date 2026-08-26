import { DashboardHome } from "@/components/layout/dashboard-home"
import { getSessionUser } from "@/lib/session"

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) return null
  return <DashboardHome user={user} />
}
