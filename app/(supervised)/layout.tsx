import { redirect } from "next/navigation"

import { RoleShell } from "@/components/layout/role-shell"
import { getRoleHome } from "@/lib/role-routing"
import { getSessionUser } from "@/lib/session"

export default async function SupervisedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser({ allowPasswordChange: true })
  if (!user) redirect("/login")
  if (user.mustChangePassword) redirect("/change-password")
  if (user.role !== "SUPERVISED") redirect(getRoleHome(user.role))
  return <RoleShell user={user}>{children}</RoleShell>
}
