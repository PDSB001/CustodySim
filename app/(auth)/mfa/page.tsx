import { ShieldCheck, Smartphone } from "lucide-react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { AuthShowcase } from "@/components/auth/auth-showcase"
import { MfaLoginForm } from "@/components/auth/mfa-login-form"
import { verifyMfaChallenge } from "@/lib/auth"
import { MFA_CHALLENGE_COOKIE_NAME } from "@/lib/constants"
import { getSessionUser } from "@/lib/session"

export default async function MfaPage() {
  const user = await getSessionUser({ allowPasswordChange: true })
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/")
  const challenge = await verifyMfaChallenge(
    (await cookies()).get(MFA_CHALLENGE_COOKIE_NAME)?.value ?? "",
  )
  if (!challenge) redirect("/login")

  return (
    <main className="mesh-bg-strong relative flex min-h-svh items-center justify-center overflow-hidden p-4 sm:p-6 lg:p-10">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-brand-500/30 absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full blur-3xl" />
        <div className="absolute -right-24 -bottom-32 h-[32rem] w-[32rem] rounded-full bg-[color:var(--chart-5)]/30 blur-3xl" />
      </div>
      <div className="bg-card/80 relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 shadow-[0_28px_96px_-32px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:min-h-[640px] lg:grid-cols-[1.05fr_0.95fr]">
        <AuthShowcase />
        <section className="bg-card/95 flex items-center justify-center p-6 sm:p-10 lg:p-12">
          <div className="w-full max-w-sm">
            <span className="from-brand-500 shadow-glow-brand grid size-11 place-items-center rounded-2xl bg-gradient-to-br to-[color:var(--chart-5)] text-white">
              <Smartphone className="size-5" />
            </span>
            <div className="border-brand-500/30 bg-brand-500/10 text-brand-700 mt-7 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em]">
              <ShieldCheck className="size-3" />
              账户安全
            </div>
            <h1 className="font-display text-foreground mt-4 text-3xl font-bold tracking-[-0.025em] sm:text-4xl">
              双重验证
            </h1>
            <p className="text-muted-foreground mt-3 text-sm leading-6">
              打开已绑定的验证器，输入当前 6
              位代码。也可以使用尚未用过的恢复码。
            </p>
            <div className="mt-8">
              <MfaLoginForm />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
