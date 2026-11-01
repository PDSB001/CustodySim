import { open } from "node:fs/promises"
import { Readable } from "node:stream"
import { appDownloadPath } from "@/lib/app-download"
import { parseDownloadRange } from "@/lib/download-range"
import { downloadVersion } from "@/lib/download-version"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ kind: string }> }
export async function GET(request: Request, context: Context) {
  return download(request, context, false)
}
export async function HEAD(request: Request, context: Context) {
  return download(request, context, true)
}

async function download(request: Request, { params }: Context, head: boolean) {
  if ((await params).kind !== "apk") return new Response(null, { status: 404 })
  let file
  try {
    file = await open(/* turbopackIgnore: true */ appDownloadPath("apk"), "r")
  } catch {
    return new Response(head ? null : "下载文件暂不可用", { status: 404 })
  }
  try {
    // Metadata and bytes refer to the same opened inode, even during replacement.
    const info = await file.stat({ bigint: true })
    if (!info.isFile()) {
      await file.close()
      return new Response(null, { status: 404 })
    }
    const size = Number(info.size)
    const modified = Math.floor(Number(info.mtimeMs) / 1000) * 1000
    const version = downloadVersion(info)
    const requestedVersion = new URL(request.url).searchParams.get("v")
    if (requestedVersion !== null && requestedVersion !== version) {
      await file.close()
      return new Response(head ? null : "安装包已更新，请返回下载页重新下载", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      })
    }
    const etag = `"${version}"`
    const headers = new Headers({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="CustodySim.apk"',
      "Cache-Control": requestedVersion
        ? "public, max-age=0, s-maxage=86400"
        : "public, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Last-Modified": new Date(modified).toUTCString(),
    })
    const noneMatch = request.headers.get("if-none-match")
    const since = Date.parse(request.headers.get("if-modified-since") ?? "")
    if (
      noneMatch
        ? noneMatch
            .split(",")
            .some(
              (tag) =>
                tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag,
            )
        : Number.isFinite(since) && modified <= since
    ) {
      await file.close()
      return new Response(null, { status: 304, headers })
    }
    const ifRange = request.headers.get("if-range")
    const rangeDate = Date.parse(ifRange ?? "")
    const rangeAllowed =
      !ifRange ||
      ifRange === etag ||
      (Number.isFinite(rangeDate) && modified <= rangeDate)
    const range =
      !head && rangeAllowed
        ? parseDownloadRange(request.headers.get("range"), size)
        : null
    if (range === "unsatisfiable") {
      await file.close()
      headers.set("Content-Range", `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set(
      "Content-Length",
      String(range ? range.end - range.start + 1 : size),
    )
    if (range)
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
    if (head) {
      await file.close()
      return new Response(null, { headers })
    }
    const stream = file.createReadStream({ autoClose: true, ...(range ?? {}) })
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    })
  } catch {
    await file.close()
    return new Response(null, { status: 500 })
  }
}
