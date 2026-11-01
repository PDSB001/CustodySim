"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { z } from "zod"
import { PageHeader } from "@/components/shared/page-header"
import { formatDate, requestApi } from "@/components/shared/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const schema = z.object({
  available: z.boolean(),
  size: z.number(),
  updatedAt: z.string().nullable(),
})
const maxBytes = 256 * 1024 * 1024
export function AppReleaseManage() {
  const status = useQuery({
    queryKey: ["app-release"],
    queryFn: ({ signal }) =>
      requestApi("/api/admin/app-release", schema, { signal }),
  })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const active = useRef<XMLHttpRequest | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(
    () => () => {
      const xhr = active.current
      active.current = null
      if (xhr) {
        xhr.onload = xhr.onerror = xhr.onabort = xhr.onloadend = null
        xhr.upload.onprogress = null
        xhr.abort()
      }
    },
    [],
  )
  function upload() {
    if (!file || active.current) return
    if (
      !file.name.toLowerCase().endsWith(".apk") ||
      file.size < 1 ||
      file.size > maxBytes
    ) {
      setError("请选择不超过 256 MB 的 .apk 安装包")
      return
    }
    setBusy(true)
    setProgress(0)
    setMessage("")
    setError("")
    const xhr = new XMLHttpRequest()
    let refreshStatus = false
    active.current = xhr
    xhr.open("PUT", "/api/admin/app-release")
    xhr.setRequestHeader(
      "Content-Type",
      "application/vnd.android.package-archive",
    )
    xhr.setRequestHeader("X-Apk-Size", String(file.size))
    xhr.responseType = "json"
    xhr.upload.onprogress = (event) => {
      if (active.current !== xhr) return
      if (event.lengthComputable)
        setProgress(Math.round((event.loaded * 100) / event.total))
    }
    xhr.onload = () => {
      if (active.current !== xhr) return
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        xhr.response?.success === true
      ) {
        setMessage("APK 已发布，下载页已更新。")
        setFile(null)
        if (input.current) input.current.value = ""
        refreshStatus = true
      } else
        setError(
          xhr.response?.error?.message ??
            (xhr.status === 413
              ? "服务器上传大小限制过低，请检查反向代理配置"
              : `上传失败（HTTP ${xhr.status}），请重试`),
        )
    }
    xhr.onerror = () => {
      if (active.current !== xhr) return
      setError("网络连接中断，请刷新安装包状态后再重试")
      refreshStatus = true
    }
    xhr.onabort = () => {
      if (active.current !== xhr) return
      setError("已取消请求，请刷新确认安装包状态")
      refreshStatus = true
    }
    xhr.onloadend = () => {
      if (active.current !== xhr) return
      active.current = null
      setBusy(false)
      if (refreshStatus) void status.refetch()
    }
    xhr.send(file)
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="App 安装包"
        description="上传 Android APK，发布后供用户从下载页获取。"
        action={
          <Button variant="outline" asChild>
            <Link href="/download" target="_blank">
              查看下载页
            </Link>
          </Button>
        }
      />
      <section className="bg-card space-y-4 rounded-2xl border p-6">
        <h2 className="font-semibold">当前安装包</h2>
        {status.isPending ? (
          <p role="status">正在读取…</p>
        ) : status.isError ? (
          <div role="alert">
            <p>{status.error.message}</p>
            <Button variant="outline" onClick={() => void status.refetch()}>
              重试
            </Button>
          </div>
        ) : status.data?.available ? (
          <p className="text-muted-foreground text-sm">
            大小 {(status.data.size / 1024 / 1024).toFixed(1)} MB · 更新时间{" "}
            {formatDate(status.data.updatedAt)}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">尚未发布安装包</p>
        )}
      </section>
      <section className="bg-card space-y-4 rounded-2xl border p-6">
        <h2 className="font-semibold">上传并发布</h2>
        <p className="text-muted-foreground text-sm">
          请选择已核对应用 ID、版本和签名的正式
          APK。发布将替换当前下载包；上传失败时保留原包。
        </p>
        <Label htmlFor="release-apk">APK 文件（最多 256 MB）</Label>
        <Input
          ref={input}
          id="release-apk"
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError("")
            setMessage("")
          }}
        />
        {busy && (
          <div role="status" className="space-y-2">
            <progress
              aria-label="上传进度"
              value={progress}
              max={100}
              className="w-full"
            />
            <p className="text-muted-foreground text-sm">
              {progress < 100
                ? `正在上传 ${progress}%`
                : "正在校验并发布，请稍候…"}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        <div className="flex gap-3">
          <Button disabled={!file || busy} onClick={upload}>
            {busy ? "正在发布…" : "上传并发布"}
          </Button>
          {busy && (
            <Button variant="outline" onClick={() => active.current?.abort()}>
              取消上传
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
