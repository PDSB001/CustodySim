import { KeyRound, ShieldCheck } from "lucide-react"
import { redirect } from "next/navigation"

import { AuthShowcase } from "@/components/auth/auth-showcase"
import { ChangePasswordForm } from "@/components/auth/change-password-form"
import { getSessionUser } from "@/lib/session"

export default async function ChangePasswordPage() {
  const user = await getSessionUser({ allowPasswordChange: true })
  if (!user) redirect("/login")

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden mesh-bg-strong p-4 sm:p-6 lg:p-10">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-brand-500/30 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-[32rem] w-[32rem] rounded-full bg-[color:var(--chart-5)]/30 blur-3xl" />
        <div className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-[color:var(--info)]/25 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-card/80 shadow-[0_28px_96px_-32px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:min-h-[640px] lg:grid-cols-[1.05fr_0.95fr]">
        <AuthShowcase />

        <section className="flex items-center justify-center bg-card/95 p-6 sm:p-10 lg:p-12">
          <div className="w-full max-w-sm">
            <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-[color:var(--chart-5)] text-white shadow-glow-brand">
              <KeyRound className="size-5" />
            </span>

            <div className="mt-7 inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] text-brand-700">
              <ShieldCheck className="size-3" />
              账户安全
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              修改密码
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {user.mustChangePassword
                ? "这是首次登录，请先设置新密码后再继续使用系统。"
                : "为保障账号安全，可随时在这里更新密码。"}
            </p>

            <div className="mt-8">
              <ChangePasswordForm forceChange={user.mustChangePassword} />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
