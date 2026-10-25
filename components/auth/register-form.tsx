"use client"
import { useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RegistrationChallenge } from "./registration-challenge"

export function RegisterForm({ nonce }: { nonce?: string }) {
  const [captchaToken, setCaptchaToken] = useState("")
  const [generation, setGeneration] = useState(0)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || !captchaToken) return
    const form = new FormData(event.currentTarget)
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          confirmPassword: form.get("confirmPassword"),
          acceptTrial: form.get("acceptTrial") === "on",
          captchaToken,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        setError(result.error?.message ?? "注册失败，请稍后重试")
        return
      }
      window.location.replace("/my")
    } catch {
      setError("注册请求未完成，请检查网络；如已创建账号，可返回登录。")
    } finally {
      pending.current = false
      setBusy(false)
      setCaptchaToken("")
      setGeneration((value) => value + 1)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {[
        {
          name: "username",
          label: "用户名",
          type: "text",
          autoComplete: "username",
          maxLength: 50,
          minLength: 3,
        },
        {
          name: "name",
          label: "显示名称",
          type: "text",
          autoComplete: "nickname",
          maxLength: 100,
          minLength: 1,
        },
        {
          name: "email",
          label: "邮箱",
          type: "email",
          autoComplete: "email",
          maxLength: 254,
          minLength: 3,
        },
        {
          name: "password",
          label: "密码（至少 8 位，含字母和数字）",
          type: "password",
          autoComplete: "new-password",
          maxLength: 128,
          minLength: 8,
        },
        {
          name: "confirmPassword",
          label: "确认密码",
          type: "password",
          autoComplete: "new-password",
          maxLength: 128,
          minLength: 8,
        },
      ].map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={`register-${field.name}`}>{field.label}</Label>
          <Input
            {...field}
            id={`register-${field.name}`}
            required
            disabled={busy}
          />
        </div>
      ))}
      <p className="text-muted-foreground text-xs leading-5">
        邮箱不进行验证，仅保存规范化摘要用于重复注册及黑名单匹配，不作为已验证的找回凭据。
      </p>
      <label
        className="flex items-start gap-2 text-sm leading-6"
        htmlFor="register-trial"
      >
        <input
          id="register-trial"
          name="acceptTrial"
          type="checkbox"
          required
          disabled={busy}
          className="mt-1.5"
        />
        我已了解：自动开通被监管人账号；自注册次日起考察七个完整上海自然日，结算后积分须大于
        0。未达标账号自动停用，注册邮箱摘要进入黑名单。
      </label>
      <RegistrationChallenge
        nonce={nonce}
        generation={generation}
        onToken={setCaptchaToken}
      />
      <p className="text-muted-foreground text-xs">
        为防止重复违规注册，将使用本网站浏览器标识和网络摘要进行限流；不采集设备指纹。
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={busy || !captchaToken} type="submit">
        {busy ? "正在创建账号…" : "注册并进入系统"}
      </Button>
      <p className="text-center text-sm">
        <Link className="underline underline-offset-4" href="/login">
          已有账号，返回登录
        </Link>
      </p>
    </form>
  )
}
