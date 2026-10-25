"use client"
import Script from "next/script"
import { useEffect, useRef, useState } from "react"

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

export function RegistrationChallenge({
  nonce,
  generation,
  onToken,
}: {
  nonce?: string
  generation: number
  onToken: (token: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!ready || !container.current || !window.turnstile) return
    let disposed = false
    let widget: string | undefined
    const controller = new AbortController()
    onToken("")
    void fetch("/api/auth/register", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json()
        const config = result.data?.captcha
        if (
          !response.ok ||
          !result.success ||
          !result.data.enabled ||
          !config?.ready
        )
          throw new Error("注册或人机验证暂不可用，请稍后重试")
        if (disposed || !container.current) return
        widget = window.turnstile!.render(container.current, {
          sitekey: config.siteKey,
          action: "register",
          cData: config.cData,
          callback: (token: string) => {
            if (!disposed) {
              setError("")
              onToken(token)
            }
          },
          "expired-callback": () => {
            if (!disposed) onToken("")
          },
          "error-callback": () => {
            if (!disposed) {
              onToken("")
              setError("人机验证失败，请重试")
            }
          },
        })
      })
      .catch((error: Error) => {
        if (!disposed) setError(error.message)
      })
    return () => {
      disposed = true
      controller.abort()
      if (widget !== undefined) window.turnstile?.remove(widget)
    }
  }, [ready, generation, retry, onToken])
  return (
    <div className="space-y-2">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        nonce={nonce}
        onReady={() => setReady(true)}
        onError={() => setError("人机验证加载失败，请检查网络后刷新页面")}
      />
      <div ref={container} aria-label="注册人机验证" />
      {!ready && !error && (
        <p role="status" className="text-sm">
          正在加载人机验证…
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              if (!ready) {
                window.location.reload()
                return
              }
              setError("")
              setRetry((value) => value + 1)
            }}
          >
            重试
          </button>
        </p>
      )}
    </div>
  )
}
