"use client"

import {
  Copy,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type TrustedDevice = {
  id: string
  label: string
  ip: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

type MfaStatus = {
  enabled: boolean
  verifiedAt: string | null
  devices: TrustedDevice[]
}

type Setup = { secret: string; otpauthUri: string }

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    success?: boolean
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || !payload.success || payload.data === undefined)
    throw new Error(payload.error?.message || "请求失败，请稍后重试")
  return payload.data
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function MfaSettings({ username }: { username: string }) {
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [setupPassword, setSetupPassword] = useState("")
  const [confirmCode, setConfirmCode] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [disablePassword, setDisablePassword] = useState("")
  const [disableCode, setDisableCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<
    "setup" | "confirm" | "disable" | string | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await readResponse<MfaStatus>(await fetch("/api/auth/mfa")))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取状态失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(successMessage)
    } catch {
      setError("复制失败，请手动复制")
    }
  }

  async function beginSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("setup")
    setError(null)
    setNotice(null)
    try {
      setSetup(
        await readResponse<Setup>(
          await fetch("/api/auth/mfa/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: setupPassword }),
          }),
        ),
      )
      setSetupPassword("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "开始配置失败")
    } finally {
      setPending(null)
    }
  }

  async function confirmSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("confirm")
    setError(null)
    try {
      const data = await readResponse<{ recoveryCodes: string[] }>(
        await fetch("/api/auth/mfa/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: confirmCode }),
        }),
      )
      setRecoveryCodes(data.recoveryCodes)
      setSetup(null)
      setConfirmCode("")
      setNotice("双重验证已启用。请立即保存恢复码。")
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证器确认失败")
    } finally {
      setPending(null)
    }
  }

  async function revokeDevice(deviceId: string) {
    setPending(deviceId)
    setError(null)
    try {
      await readResponse<{ revoked: true }>(
        await fetch(`/api/auth/mfa/devices/${encodeURIComponent(deviceId)}`, {
          method: "DELETE",
        }),
      )
      setNotice("已撤销该设备的免验证权限。")
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤销设备失败")
    } finally {
      setPending(null)
    }
  }

  async function disableMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("disable")
    setError(null)
    try {
      await readResponse<{ disabled: true }>(
        await fetch("/api/auth/mfa/disable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: disablePassword,
            code: disableCode,
          }),
        }),
      )
      setDisablePassword("")
      setDisableCode("")
      setRecoveryCodes(null)
      setNotice("双重验证已关闭，所有受信任设备已撤销。")
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "关闭双重验证失败")
    } finally {
      setPending(null)
    }
  }

  if (loading)
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center">
        <Loader2 className="mr-2 size-4 animate-spin" /> 正在读取安全设置…
      </div>
    )

  return (
    <div className="space-y-5">
      {error ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border px-3 py-2.5 text-sm"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="text-brand-600 size-4" /> 验证器应用
          </CardTitle>
          <CardDescription>
            使用 Microsoft Authenticator、Google Authenticator
            或兼容应用生成一次性代码。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.enabled ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3.5 text-sm">
              <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-foreground font-semibold">双重验证已启用</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  每台新设备需验证一次；受信任设备最多保留 30 天。
                </p>
              </div>
            </div>
          ) : setup ? (
            <div className="border-brand-500/30 bg-brand-500/5 space-y-4 rounded-xl border p-4">
              <div className="space-y-1">
                <p className="font-semibold">第 1 步：在验证器中手动添加账户</p>
                <p className="text-muted-foreground text-sm">
                  账户名称填写{" "}
                  <span className="text-foreground font-medium">
                    CustodySim ({username})
                  </span>
                  ，类型选择“基于时间”。
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-semibold tracking-wide">
                  密钥
                </p>
                <div className="flex items-center gap-2">
                  <code className="bg-background text-foreground min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold tracking-[0.12em] break-all">
                    {setup.secret}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="复制密钥"
                    onClick={() =>
                      void copyText(setup.secret, "验证器密钥已复制")
                    }
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  密钥只在本次配置中显示；请勿截图、转发或交给他人。
                </p>
              </div>
              <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={confirmSetup}
              >
                <Input
                  value={confirmCode}
                  onChange={(event) => setConfirmCode(event.target.value)}
                  placeholder="第 2 步：输入 6 位验证器代码"
                  autoComplete="one-time-code"
                  required
                />
                <Button
                  type="submit"
                  disabled={pending === "confirm" || !confirmCode.trim()}
                  className="shrink-0"
                >
                  {pending === "confirm" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  确认启用
                </Button>
              </form>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={beginSetup}
            >
              <Input
                type="password"
                value={setupPassword}
                onChange={(event) => setSetupPassword(event.target.value)}
                placeholder="输入当前密码以继续"
                autoComplete="current-password"
                disabled={pending === "setup"}
                required
              />
              <Button
                type="submit"
                disabled={pending === "setup" || !setupPassword}
                className="shrink-0"
              >
                {pending === "setup" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Smartphone />
                )}
                启用验证器
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {recoveryCodes ? (
        <Card className="border-amber-500/35">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <KeyRound className="size-4" /> 恢复码
            </CardTitle>
            <CardDescription>
              每个恢复码只能使用一次。它们不会再次完整显示，请保存到安全的离线位置。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {recoveryCodes.map((code) => (
                <code
                  key={code}
                  className="bg-muted rounded-lg px-3 py-2 text-center text-sm font-semibold tracking-wider"
                >
                  {code}
                </code>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void copyText(recoveryCodes.join("\n"), "恢复码已复制")
              }
            >
              <Copy />
              复制全部恢复码
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {status?.enabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>受信任设备</CardTitle>
              <CardDescription>
                这些设备在 Cookie
                有效期内登录时不再要求验证器代码。撤销后下次登录会重新验证。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {status.devices.length ? (
                status.devices.map((device) => (
                  <div
                    key={device.id}
                    className="border-border/70 flex items-center justify-between gap-3 rounded-xl border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground font-medium">
                        {device.label}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {device.ip ? `${device.ip} · ` : ""}上次使用：
                        {formatTime(device.lastUsedAt)} · 到期：
                        {formatTime(device.expiresAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="撤销此设备"
                      disabled={pending === device.id}
                      onClick={() => void revokeDevice(device.id)}
                    >
                      {pending === device.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Trash2 className="text-destructive" />
                      )}
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">
                  没有受信任设备。登录时勾选“免再次验证”后会显示在这里。
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <ShieldAlert className="size-4" />
                关闭双重验证
              </CardTitle>
              <CardDescription>
                关闭需要当前密码和验证器代码（或恢复码），并会撤销所有设备的免验证权限。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3 sm:grid-cols-3" onSubmit={disableMfa}>
                <Input
                  type="password"
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                  placeholder="当前密码"
                  autoComplete="current-password"
                  required
                />
                <Input
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value)}
                  placeholder="验证器代码或恢复码"
                  autoComplete="one-time-code"
                  required
                />
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={
                    pending === "disable" || !disablePassword || !disableCode
                  }
                >
                  {pending === "disable" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ShieldAlert />
                  )}
                  关闭
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
