import { redirect } from "next/navigation"

import { DashboardShell } from "@/components/layout/dashboard-shell"
import { getRoleHome } from "@/lib/role-routing"
import { getSessionUser } from "@/lib/session"

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser({ allowPasswordChange: true })
  if (!user) redirect("/login")
  if (user.mustChangePassword) redirect("/change-password")
  if (user.role !== "ADMIN") redirect(getRoleHome(user.role))
  return <DashboardShell user={user}>{children}</DashboardShell>
}
