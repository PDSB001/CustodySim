"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const Status = z.object({
  bindingEnabled: z.boolean(),
  configured: z.boolean(),
  maskedEmail: z.string().nullable(),
  verifiedAt: z.string().nullable(),
})
const Challenge = z.object({
  challengeId: z.string(),
  maskedEmail: z.string(),
  expiresIn: z.number(),
  resendAfter: z.number(),
})
export function SecurityEmailSettings({ mfaEnabled }: { mfaEnabled: boolean }) {
  const router = useRouter()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["security-email"],
    queryFn: () => requestApi("/api/auth/security-email", Status),
    staleTime: 0,
  })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mfaCode, setMfaCode] = useState("")
  const [emailCode, setEmailCode] = useState("")
  const [challenge, setChallenge] = useState<z.infer<typeof Challenge> | null>(
    null,
  )
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  async function send(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const result = await requestApi(
        "/api/auth/security-email/send",
        Challenge,
        {
          method: "POST",
          body: JSON.stringify({ email, password, code: mfaCode }),
        },
      )
      setChallenge(result)
      setCooldown(result.resendAfter)
      setEmailCode("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送失败")
    } finally {
      setBusy(false)
      setPassword("")
      setMfaCode("")
    }
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault()
    if (!challenge) return
    setBusy(true)
    setError("")
    try {
      await requestApi(
        "/api/auth/security-email/confirm",
        z.object({ verified: z.boolean(), requiresLogin: z.boolean() }),
        {
          method: "POST",
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            code: emailCode,
          }),
        },
      )
      setDone(true)
      setChallenge(null)
      setEmailCode("")
      client.removeQueries({ queryKey: ["security-email"] })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>安全邮箱</CardTitle>
        <CardDescription>
          用于绑定确认和安全通知。遗失验证器时请使用离线恢复码或联系管理员，邮箱验证码不能替代登录
          MFA。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending && <p role="status">正在读取邮箱状态…</p>}
        {query.isError && <p role="alert">{query.error.message}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {done ? (
          <div role="status">
            <p>邮箱验证成功，旧会话和受信任设备已撤销。请重新登录。</p>
            <Button
              className="mt-3"
              onClick={() => {
                router.replace("/login")
                router.refresh()
              }}
            >
              重新登录
            </Button>
          </div>
        ) : (
          query.data && (
            <>
              <p>已验证邮箱：{query.data.maskedEmail ?? "未绑定"}</p>
              {!query.data.bindingEnabled || !query.data.configured ? (
                <p className="text-muted-foreground text-sm">
                  管理员尚未开启邮箱绑定服务。
                </p>
              ) : (
                <>
                  <form onSubmit={send} className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="security-email">
                        {query.data.maskedEmail ? "新邮箱" : "邮箱地址"}
                      </Label>
                      <Input
                        id="security-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        maxLength={254}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email-password">当前密码</Label>
                      <Input
                        id="email-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    {mfaEnabled && (
                      <div className="space-y-2">
                        <Label htmlFor="email-mfa-code">
                          验证器代码或恢复码
                        </Label>
                        <Input
                          id="email-mfa-code"
                          autoComplete="one-time-code"
                          value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)}
                          required
                          maxLength={32}
                        />
                      </div>
                    )}
                    <Button type="submit" disabled={busy || cooldown > 0}>
                      {cooldown > 0
                        ? `${cooldown} 秒后可重发`
                        : challenge
                          ? "重新发送验证码"
                          : "发送邮箱验证码"}
                    </Button>
                  </form>
                  {challenge && (
                    <form
                      onSubmit={confirm}
                      className="space-y-3 border-t pt-4"
                    >
                      <p role="status" className="text-sm">
                        验证码已发送至 {challenge.maskedEmail}，5
                        分钟有效。重发后旧码失效。
                      </p>
                      <Label htmlFor="email-confirm-code">邮箱验证码</Label>
                      <Input
                        id="email-confirm-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value)}
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                      />
                      <p className="text-muted-foreground text-sm">
                        确认后将退出所有登录并撤销受信任设备；换绑时会通知原邮箱。
                      </p>
                      <Button type="submit" disabled={busy}>
                        确认绑定
                      </Button>
                    </form>
                  )}
                </>
              )}
            </>
          )
        )}
      </CardContent>
    </Card>
  )
}
