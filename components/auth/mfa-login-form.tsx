"use client"

import { Loader2, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { getRoleHome } from "@/lib/role-routing"
import { SessionUserSchema } from "@/lib/auth-schemas"

export function MfaLoginForm() {
  const [code, setCode] = useState("")
  const [trustDevice, setTrustDevice] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, trustDevice }),
      })
      const payload = (await response.json()) as {
        success?: boolean
        data?: unknown
        error?: { message?: string }
      }
      if (!response.ok || !payload.success) {
        setError(payload.error?.message || "验证未通过，请检查代码后重试。")
        return
      }
      const user = SessionUserSchema.safeParse(payload.data)
      if (!user.success) {
        setError("登录信息已失效，请返回登录页重试。")
        return
      }
      window.location.replace(
        user.data.mustChangePassword
          ? "/change-password"
          : getRoleHome(user.data.role),
      )
    } catch {
      setError("暂时无法完成验证，请检查网络后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="mfa-code"
          className="text-foreground/70 text-xs font-semibold tracking-wide"
        >
          一次性验证码或恢复码
        </label>
        <Input
          id="mfa-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="输入 6 位验证码或恢复码"
          autoComplete="one-time-code"
          inputMode="text"
          disabled={submitting}
          required
          className="h-11 rounded-xl"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
        <Checkbox
          checked={trustDevice}
          onCheckedChange={(checked) => setTrustDevice(checked === true)}
          disabled={submitting}
        />
        在此设备保持登录 30 天
      </label>
      {error ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-xs"
        >
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        disabled={submitting || !code.trim()}
        className="from-brand-600 hover:from-brand-700 h-11 w-full rounded-xl bg-gradient-to-r to-[color:var(--chart-5)] text-white shadow-[0_8px_24px_-8px_rgba(112,80,255,0.6)] hover:to-[color:var(--chart-5)]"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        验证并继续
      </Button>
    </form>
  )
}
