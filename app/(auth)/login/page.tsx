import { ShieldCheck, Sparkles } from "lucide-react"
import { redirect } from "next/navigation"

import { AuthShowcase } from "@/components/auth/auth-showcase"
import { LoginForm } from "@/components/auth/login-form"
import { getSessionUser } from "@/lib/session"

export default async function LoginPage() {
  const user = await getSessionUser({ allowPasswordChange: true })
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/")

  return (
    <main className="mesh-bg-strong relative flex min-h-svh items-center justify-center overflow-hidden p-4 sm:p-6 lg:p-10">
      {/* 浮动装饰：背景的彩色光斑 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-brand-500/30 absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full blur-3xl" />
        <div className="absolute -right-24 -bottom-32 h-[32rem] w-[32rem] rounded-full bg-[color:var(--chart-5)]/30 blur-3xl" />
        <div className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-[color:var(--info)]/25 blur-3xl" />
      </div>

      <div className="bg-card/80 relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 shadow-[0_28px_96px_-32px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:min-h-[560px] lg:grid-cols-[1.05fr_0.95fr]">
        <AuthShowcase />

        {/* pb 略大于 pt：登录内容视觉中心略高于数学中心，避免看起来"偏上" */}
        <section className="bg-card/95 flex items-center justify-center p-6 sm:p-9 lg:px-10 lg:pt-10 lg:pb-14 xl:px-11 xl:pt-11 xl:pb-16">
          <div className="w-full max-w-sm">
            <div className="mb-7 flex items-center gap-2 lg:hidden">
              <span className="from-brand-500 shadow-glow-brand grid size-10 place-items-center rounded-xl bg-gradient-to-br to-[color:var(--chart-5)] text-white">
                <ShieldCheck className="size-5" />
              </span>
              <p className="text-foreground text-sm font-semibold tracking-[-0.01em]">
                CustodySim
              </p>
            </div>

            <div className="border-brand-500/30 bg-brand-500/10 text-brand-700 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.1em]">
              <Sparkles className="size-3" />
              身份核验
            </div>
            <h1 className="font-display text-foreground mt-3.5 text-3xl font-bold tracking-[-0.025em] sm:text-4xl">
              进入 CustodySim
            </h1>
            <p className="text-foreground/75 mt-2.5 text-sm leading-6">
              验证身份后，进入管理处、值班室或你的监室。
            </p>

            <div className="mt-7">
              <LoginForm />
            </div>

            <p className="text-muted-foreground/70 mt-7 text-center text-xs">
              CustodySim · 监管任务模拟系统
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
