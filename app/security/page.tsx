import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { MfaSettings } from "@/components/security/mfa-settings"
import { Button } from "@/components/ui/button"
import { getRoleHome } from "@/lib/role-routing"
import { getSessionUser } from "@/lib/session"

export default async function SecurityPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login")

  return (
    <main className="min-h-svh bg-muted/30 px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-700 text-sm font-semibold"><ShieldCheck className="size-4" />账户安全</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.025em] text-foreground">双重验证</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">为账号绑定验证器应用，并管理受信任设备。</p>
          </div>
          <Button asChild variant="outline"><Link href={getRoleHome(user.role)}>返回工作台</Link></Button>
        </div>
        <MfaSettings username={user.username} />
      </div>
    </main>
  )
}
