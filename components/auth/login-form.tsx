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
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="username"
          className="text-foreground/70 text-xs font-semibold tracking-wide"
        >
          账号
        </label>
        <InputGroup className="border-border/70 bg-background/80 focus-within:border-brand-500 focus-within:ring-brand-500/30 h-11 rounded-xl transition focus-within:ring-2">
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
          className="text-foreground/70 text-xs font-semibold tracking-wide"
        >
          密码
        </label>
        <InputGroup className="border-border/70 bg-background/80 focus-within:border-brand-500 focus-within:ring-brand-500/30 h-11 rounded-xl transition focus-within:ring-2">
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

      {error ? (
        <div className="border-overdue/30 bg-overdue/10 text-overdue rounded-lg border px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={submitting}
        className="from-brand-600 hover:from-brand-700 mt-2 h-11 w-full rounded-xl bg-gradient-to-r to-[color:var(--chart-5)] text-white shadow-[0_8px_24px_-8px_rgba(112,80,255,0.6)] hover:to-[color:var(--chart-5)]"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : "登 录"}
      </Button>
    </form>
  )
}
