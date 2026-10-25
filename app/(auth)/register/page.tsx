import Link from "next/link"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { RegisterForm } from "@/components/auth/register-form"
import { getRegistrationSettings } from "@/lib/registration-server"
import { getSessionUser } from "@/lib/session"
export default async function RegisterPage() {
  if (await getSessionUser({ allowPasswordChange: true })) redirect("/")
  let enabled = false
  try {
    enabled = (await getRegistrationSettings()).enabled
  } catch {
    /* Fail closed during an incomplete migration. */
  }
  return (
    <main className="mesh-bg-strong flex min-h-svh items-center justify-center p-4 py-10">
      <section className="bg-card w-full max-w-lg space-y-5 rounded-3xl border p-6 shadow-lg sm:p-8">
        <div>
          <p className="text-muted-foreground text-sm">CustodySim · Web 注册</p>
          <h1 className="mt-2 text-2xl font-semibold">开始首周考察</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            加入新用户监室，按现有打卡、任务和阅读规则获得积分。
          </p>
        </div>
        {enabled ? (
          <RegisterForm nonce={(await headers()).get("x-nonce") ?? undefined} />
        ) : (
          <div role="status" className="space-y-4">
            <p>注册暂未开放，请稍后再试。</p>
            <Link href="/login" className="underline">
              返回登录
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
