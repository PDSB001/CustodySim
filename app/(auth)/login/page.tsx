import { ShieldCheck, Sparkles } from "lucide-react"
import { redirect } from "next/navigation"

import { AuthShowcase } from "@/components/auth/auth-showcase"
import { LoginForm } from "@/components/auth/login-form"
import { getSessionUser } from "@/lib/session"

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/")

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden mesh-bg-strong p-4 sm:p-6 lg:p-10">
      {/* 浮动装饰：背景的彩色光斑 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-brand-500/30 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-[32rem] w-[32rem] rounded-full bg-[color:var(--chart-5)]/30 blur-3xl" />
        <div className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-[color:var(--info)]/25 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-card/80 shadow-[0_28px_96px_-32px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:min-h-[640px] lg:grid-cols-[1.05fr_0.95fr]">
        <AuthShowcase />

        <section className="flex items-center justify-center bg-card/95 p-6 sm:p-10 lg:p-12 xl:p-14">
          <div className="w-full max-w-sm">
            <div className="mb-9 flex items-center gap-2 lg:hidden">
              <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-[color:var(--chart-5)] text-white shadow-glow-brand">
                <ShieldCheck className="size-5" />
              </span>
              <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">
                CustodySim
              </p>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] text-brand-700">
              <Sparkles className="size-3" />
              欢迎回来
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              登录工作台
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              请输入账号和密码，继续你的监管任务。
            </p>

            <div className="mt-9">
              <LoginForm />
            </div>

            <p className="mt-9 text-center text-[11px] text-muted-foreground/70">
              CustodySim · 监管任务模拟系统
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}