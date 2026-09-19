"use client"

import { Loader2, Lock, UserRound } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

export function LoginForm() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password"),
        }),
      })
      const data = (await res.json()) as {
        success?: boolean
        data?: unknown
        error?: { code?: string; message?: string }
      }
      if (!res.ok || !data.success) {
        setError(data.error?.message || "登录失败，请稍后再试。")
        setSubmitting(false)
        return
      }
      const requiresMfa =
        typeof data.data === "object" &&
        data.data !== null &&
        "requiresMfa" in data.data &&
        data.data.requiresMfa === true
      if (requiresMfa) {
        window.location.replace("/mfa")
        return
      }
      const mustChangePassword =
        typeof data.data === "object" &&
        data.data !== null &&
        "mustChangePassword" in data.data &&
        data.data.mustChangePassword === true
      window.location.replace(mustChangePassword ? "/change-password" : "/")
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常，请检查连接。")
      setSubmitting(false)
    }
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="username"
          className="text-foreground/80 text-xs font-semibold tracking-wide"
        >
          账号
        </label>
        <InputGroup className="border-border/70 bg-muted/45 focus-within:border-brand-500/70 focus-within:bg-card focus-within:ring-brand-500/20 h-11 rounded-xl transition focus-within:ring-[3px]">
          <InputGroupAddon align="inline-start">
            <UserRound className="text-muted-foreground size-4" />
          </InputGroupAddon>
          <InputGroupInput
            id="username"
            name="username"
            placeholder="请输入账号"
            autoComplete="username"
            required
            disabled={submitting}
          />
        </InputGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-foreground/80 text-xs font-semibold tracking-wide"
        >
          密码
        </label>
        <InputGroup className="border-border/70 bg-muted/45 focus-within:border-brand-500/70 focus-within:bg-card focus-within:ring-brand-500/20 h-11 rounded-xl transition focus-within:ring-[3px]">
          <InputGroupAddon align="inline-start">
            <Lock className="text-muted-foreground size-4" />
          </InputGroupAddon>
          <InputGroupInput
            id="password"
            type="password"
            name="password"
            placeholder="请输入密码"
            autoComplete="current-password"
            required
            disabled={submitting}
          />
        </InputGroup>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      {/* 品牌渐变收窄在主蓝紫色相内，避免高饱和霓虹紫；hover/active 只做轻微变化 */}
      <Button
        type="submit"
        size="lg"
        disabled={submitting}
        className="from-brand-600 to-brand-400 mt-1 h-11 w-full rounded-xl bg-gradient-to-r text-white shadow-md shadow-brand-600/25 hover:from-brand-700 hover:shadow-lg hover:shadow-brand-600/30"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : "登 录"}
      </Button>
    </form>
  )
}
