import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"

export const APK_MAX_BYTES = 256 * 1024 * 1024
export class ApkUploadError extends Error {}

// Validate the ZIP directory without decompressing or loading the APK into memory.
export async function validateApk(filename: string) {
  const file = await open(filename, "r")
  try {
    const { size } = await file.stat()
    const tail = Buffer.alloc(Math.min(size, 65557))
    await file.read(tail, 0, tail.length, size - tail.length)
    let end = tail.length - 22
    for (; end >= 0; end--) {
      if (
        tail.readUInt32LE(end) === 0x06054b50 &&
        end + 22 + tail.readUInt16LE(end + 20) === tail.length
      )
        break
    }
    if (end < 0) throw new ApkUploadError("文件不是有效的 APK 压缩包")
    const count = tail.readUInt16LE(end + 10)
    const directorySize = tail.readUInt32LE(end + 12)
    const offset = tail.readUInt32LE(end + 16)
    if (
      !count ||
      directorySize > 16 * 1024 * 1024 ||
      offset + directorySize > size - tail.length + end ||
      tail.readUInt16LE(end + 4) ||
      tail.readUInt16LE(end + 6)
    )
      throw new ApkUploadError("APK 目录结构不受支持")
    const directory = Buffer.alloc(directorySize)
    const read = await file.read(directory, 0, directorySize, offset)
    if (read.bytesRead !== directorySize)
      throw new ApkUploadError("APK 文件不完整")
    const names = new Set<string>()
    let cursor = 0
    for (let i = 0; i < count; i++) {
      if (
        cursor + 46 > directory.length ||
        directory.readUInt32LE(cursor) !== 0x02014b50
      )
        throw new ApkUploadError("APK 目录损坏")
      const nameSize = directory.readUInt16LE(cursor + 28)
      const next =
        cursor +
        46 +
        nameSize +
        directory.readUInt16LE(cursor + 30) +
        directory.readUInt16LE(cursor + 32)
      if (next > directory.length) throw new ApkUploadError("APK 目录损坏")
      names.add(directory.toString("utf8", cursor + 46, cursor + 46 + nameSize))
      cursor = next
    }
    if (
      cursor !== directory.length ||
      !names.has("AndroidManifest.xml") ||
      !names.has("classes.dex")
    )
      throw new ApkUploadError("请选择完整的 Android APK 安装包")
  } finally {
    await file.close()
  }
}

export async function saveApk(
  body: ReadableStream<Uint8Array>,
  destination: string,
  declaredSize: number,
  onPublished: (data: { size: number; sha256: string }) => Promise<void>,
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(declaredSize) ||
    declaredSize < 1 ||
    declaredSize > APK_MAX_BYTES
  )
    throw new ApkUploadError("APK 大小必须在 1 字节至 256 MB 之间")
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = path.join(
    path.dirname(destination),
    `.upload-${randomUUID()}.tmp`,
  )
  const file = await open(temporary, "wx")
  const backup = `${temporary}.previous`
  const reader = body.getReader()
  const hash = createHash("sha256")
  let size = 0
  let closed = false
  let backedUp = false
  let replaced = false
  try {
    while (true) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > declaredSize || size > APK_MAX_BYTES)
        throw new ApkUploadError("上传大小超出限制")
      hash.update(value)
      await file.writeFile(value)
    }
    if (size !== declaredSize)
      throw new ApkUploadError("文件上传不完整，请重试")
    await file.sync()
    await file.close()
    closed = true
    await validateApk(temporary)
    const result = { size, sha256: hash.digest("hex") }
    signal?.throwIfAborted()
    // Caller holds the cross-process publication lock until audit and rollback finish.
    // A hard link retains the previous inode without interrupting current downloads.
    try {
      await link(destination, backup)
      backedUp = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await rename(temporary, destination)
    replaced = true
    // Do not abort after replacement: the final publication still needs its audit.
    await onPublished(result)
    return result
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (replaced) {
      try {
        if (backedUp) {
          await rename(backup, destination)
          backedUp = false
        } else await rm(destination)
      } catch (restoreError) {
        // Retain the backup for recovery if the filesystem itself prevents rollback.
        backedUp = false
        throw new AggregateError(
          [error, restoreError],
          "APK 发布失败，旧包备份需要恢复",
          { cause: error },
        )
      }
    }
    throw error
  } finally {
    reader.releaseLock()
    if (!closed) await file.close()
    await rm(temporary, { force: true })
    if (backedUp)
      await rm(backup, { force: true }).catch((error) =>
        console.error("[app-release] backup cleanup failed", error),
      )
  }
}
