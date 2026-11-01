import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
const faults = vi.hoisted(() => ({ renameDestination: "" }))
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (args[1] === faults.renameDestination)
        throw Object.assign(new Error("rename denied"), { code: "EACCES" })
      return actual.rename(...args)
    },
  }
})
import { zipSync, strToU8 } from "fflate"
import { APK_MAX_BYTES, saveApk, validateApk } from "@/lib/apk-upload"

let folder = ""
afterEach(() => {
  faults.renameDestination = ""
})
beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "custodysim-apk-"))
})
afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
})
function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}
const apk = zipSync({
  "AndroidManifest.xml": strToU8("manifest"),
  "classes.dex": strToU8("dex"),
})
test("有效 APK 原子替换后才记录成功审计和摘要", async () => {
  const destination = path.join(folder, "valid.apk")
  await writeFile(destination, "old")
  const audit = vi.fn(async () => {
    expect(await readFile(destination)).toEqual(Buffer.from(apk))
  })
  const result = await saveApk(stream(apk), destination, apk.length, audit)
  expect(result.size).toBe(apk.length)
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(audit).toHaveBeenCalledOnce()
  expect(await readFile(destination)).toEqual(Buffer.from(apk))
  await validateApk(destination)
})

test("替换目标失败时不写成功审计，首次发布审计失败时撤回新包", async () => {
  const blocked = path.join(folder, "directory.apk")
  await mkdir(blocked)
  const audit = vi.fn(async () => {})
  await expect(
    saveApk(stream(apk), blocked, apk.length, audit),
  ).rejects.toThrow()
  expect(audit).not.toHaveBeenCalled()
  const first = path.join(folder, "first.apk")
  await expect(
    saveApk(stream(apk), first, apk.length, async () => {
      throw new Error("audit unavailable")
    }),
  ).rejects.toThrow("audit unavailable")
  await expect(readFile(first)).rejects.toMatchObject({ code: "ENOENT" })
  expect(
    (await readdir(folder)).filter((name) => name.startsWith(".upload-")),
  ).toEqual([])
})

test("旧包已备份但 rename 失败时不写成功审计，保留原包并清理备份", async () => {
  const destination = path.join(folder, "rename-failure.apk")
  await writeFile(destination, "previous")
  faults.renameDestination = destination
  const audit = vi.fn(async () => {})
  await expect(
    saveApk(stream(apk), destination, apk.length, audit),
  ).rejects.toThrow("rename denied")
  expect(audit).not.toHaveBeenCalled()
  expect(await readFile(destination, "utf8")).toBe("previous")
  expect(
    (await readdir(folder)).filter((name) => name.startsWith(".upload-")),
  ).toEqual([])
})
test("截断、超出声明大小、非 APK 和审计失败均保留原包并清理临时文件", async () => {
  const destination = path.join(folder, "preserved.apk")
  await writeFile(destination, "old")
  const ok = async () => {}
  await expect(
    saveApk(stream(apk), destination, apk.length + 1, ok),
  ).rejects.toThrow("不完整")
  await expect(
    saveApk(stream(apk), destination, apk.length - 1, ok),
  ).rejects.toThrow("超出")
  const zip = zipSync({ "other.txt": strToU8("not apk") })
  await expect(
    saveApk(stream(zip), destination, zip.length, ok),
  ).rejects.toThrow("完整的 Android")
  await expect(
    saveApk(stream(apk), destination, apk.length, async () => {
      throw new Error("audit unavailable")
    }),
  ).rejects.toThrow("audit unavailable")
  await expect(
    saveApk(stream(apk), destination, APK_MAX_BYTES + 1, ok),
  ).rejects.toThrow("256 MB")
  expect(await readFile(destination, "utf8")).toBe("old")
  expect(
    (await readdir(folder)).filter((name) => name.endsWith(".tmp")),
  ).toEqual([])
})
