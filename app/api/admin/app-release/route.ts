import { stat } from "node:fs/promises"
import { NextRequest } from "next/server"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { appDownloadPath } from "@/lib/app-download"
import { APK_MAX_BYTES, ApkUploadError, saveApk } from "@/lib/apk-upload"
import { writeAuditLog } from "@/lib/audit"
import { isSameOriginMutation } from "@/lib/request-origin"
import {
  AppReleaseConflictError,
  withAppReleaseLock,
} from "@/lib/app-release-server"
import { secureStreamApiResponse } from "@/lib/stream-api-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return secured(getStatus)
}

async function secured(action: () => Promise<Response>) {
  try {
    return secureStreamApiResponse(await action())
  } catch {
    console.error("[app-release] request failed")
    return secureStreamApiResponse(
      failure("INTERNAL_ERROR", "安装包管理暂不可用，请稍后重试", 500),
    )
  }
}

async function getStatus() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理安装包", 403)
  try {
    const file = await stat(/* turbopackIgnore: true */ appDownloadPath("apk"))
    return success({
      available: file.isFile(),
      size: file.size,
      updatedAt: file.mtime.toISOString(),
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return success({ available: false, size: 0, updatedAt: null })
    return failure("INTERNAL_ERROR", "无法读取安装包状态", 500)
  }
}

export async function PUT(request: NextRequest) {
  return secured(() => publish(request))
}

async function publish(request: NextRequest) {
  // This streaming endpoint is excluded from Proxy body buffering; preserve CSRF checks here.
  if (!isSameOriginMutation(request))
    return failure("FORBIDDEN", "请求来源不受信任", 403)
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可上传安装包", 403)
  const size = Number(request.headers.get("x-apk-size"))
  if (!Number.isSafeInteger(size) || size < 1 || size > APK_MAX_BYTES)
    return failure("VALIDATION_ERROR", "安装包不能超过 256 MB", 413)
  if (!request.body)
    return failure("VALIDATION_ERROR", "请选择 APK 安装包", 400)
  try {
    const body = request.body
    const result = await withAppReleaseLock(() =>
      saveApk(
        body,
        appDownloadPath("apk"),
        size,
        async (data) => {
          await writeAuditLog({
            actor,
            action: "UPLOAD",
            actionLabel: "发布 APK 成功",
            entityType: "app_release",
            detail: data,
          })
        },
        request.signal,
      ),
    )
    return success(result)
  } catch (error) {
    if (error instanceof AppReleaseConflictError)
      return failure("CONFLICT", error.message, 409)
    if (error instanceof ApkUploadError)
      return failure("VALIDATION_ERROR", error.message, 400)
    console.error("[app-release] upload failed")
    return failure(
      "INTERNAL_ERROR",
      "上传未完成，请检查服务器存储或稍后重试",
      500,
    )
  }
}
