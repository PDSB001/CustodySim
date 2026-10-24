import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { Reader } from "maxmind"
import type { CityResponse } from "maxmind"

import {
  GEOIP_DATABASE_FILENAME,
  getGeoIpDataDir,
  getGeoIpDatabasePath,
  getGeoIpVersionPath,
  loadGeoIpReader,
  readGeoIpVersion,
  releaseGeoIpReader,
} from "@/lib/geoip-database"
import type { GeoIpVersionRecord } from "@/lib/geoip-database"
import { startIntervalScheduler } from "@/lib/interval-scheduler"

/**
 * 数据源：NetworkCats/Merged-IP-Data。
 *
 * 该仓库每天 01:00 UTC 用 GitHub Actions 把 GeoLite2、DB-IP、IPinfo、QQWry、
 * 代理/VPN 名单等多个来源按字段优先级合并成单个 `Merged-IP.mmdb`，字段与
 * GeoLite2-City 兼容（country / subdivisions / city / location.time_zone）。
 * 它**不提供**官方校验和，因此这里靠三件事保证可用性：
 *   1. 传输层校验：内容长度 + 自算 SHA-256，写入版本记录供事后对账；
 *   2. 结构校验：用真正的 mmdb 读取器打开，并抽查若干固定 IP；
 *   3. 可回滚：装库前把旧文件改名保留，新文件读不出来时自动还原。
 */
export const GEOIP_SOURCE_REPOSITORY = "NetworkCats/Merged-IP-Data"
export const GEOIP_SOURCE_URL = `https://github.com/${GEOIP_SOURCE_REPOSITORY}`
export const GEOIP_UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

const RELEASE_API_URL = `https://api.github.com/repos/${GEOIP_SOURCE_REPOSITORY}/releases/latest`
const LATEST_DOWNLOAD_URL = `https://github.com/${GEOIP_SOURCE_REPOSITORY}/releases/latest/download/${GEOIP_DATABASE_FILENAME}`

/** 合并库约 96MB；区间用来挡住错误页面和异常截断，而不是精确校验。 */
const MIN_DATABASE_BYTES = 20 * 1024 * 1024
const MAX_DATABASE_BYTES = 512 * 1024 * 1024
/** 版本记录超过这个年龄就不再凭 ETag 跳过，避免上游换了 ETag 策略后长期不更新。 */
const ETAG_TRUST_MS = 8 * 24 * 60 * 60 * 1000
const LOCK_STALE_MS = 6 * 60 * 60 * 1000
const KEPT_BACKUPS = 2

const USER_AGENT = "CustodySim-GeoIP-updater"

type Logger = (message: string) => void

type RemoteDatabase = {
  assetUrl: string
  tag: string | null
  publishedAt: string | null
  digest: string | null
  size: number | null
  etag: string | null
}

export type GeoIpUpdateResult =
  | { status: "updated"; version: GeoIpVersionRecord; databasePath: string }
  | {
      status: "up-to-date"
      tag: string | null
      sha256: string | null
      downloadedAt: string | null
    }
  | { status: "skipped"; reason: string }

function isValidGithubAssetUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "github.com"
  } catch {
    return false
  }
}

/** 官方 Release 元数据（可带 token 提高限额）；任何失败都只退化为 null。 */
async function fetchReleaseMetadata(): Promise<RemoteDatabase | null> {
  const token = process.env.GEOIP_GITHUB_TOKEN?.trim()
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return null
    const value = (await response.json()) as {
      tag_name?: unknown
      published_at?: unknown
      assets?: unknown
    }
    if (typeof value.tag_name !== "string" || !value.tag_name) return null
    if (!Array.isArray(value.assets)) return null
    const asset = value.assets.find(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(candidate) &&
        typeof candidate === "object" &&
        (candidate as { name?: unknown }).name === GEOIP_DATABASE_FILENAME,
    )
    const assetUrl = asset?.browser_download_url
    if (typeof assetUrl !== "string" || !isValidGithubAssetUrl(assetUrl))
      return null
    const digest =
      typeof asset?.digest === "string" &&
      /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
        ? asset.digest.slice("sha256:".length).toLowerCase()
        : null
    return {
      assetUrl,
      tag: value.tag_name,
      publishedAt:
        typeof value.published_at === "string" ? value.published_at : null,
      digest,
      size:
        typeof asset?.size === "number" && Number.isSafeInteger(asset.size)
          ? asset.size
          : null,
      etag: null,
    }
  } catch {
    return null
  }
}

/**
 * API 被限流时的降级路径：只发 HEAD 拿 ETag 与长度。
 * 每日重建会换 ETag，所以 ETag 相同基本意味着"这一版还没换"。
 */
async function probeLatestAsset(): Promise<RemoteDatabase> {
  const response = await fetch(LATEST_DOWNLOAD_URL, {
    method: "HEAD",
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(
      "无法访问 " + GEOIP_SOURCE_REPOSITORY + " 最新数据库：HTTP " + response.status,
    )
  const length = Number(response.headers.get("content-length") ?? "")
  return {
    assetUrl: LATEST_DOWNLOAD_URL,
    tag: null,
    publishedAt: null,
    digest: null,
    size: Number.isSafeInteger(length) && length > 0 ? length : null,
    etag: response.headers.get("etag"),
  }
}

async function resolveRemoteDatabase() {
  return (await fetchReleaseMetadata()) ?? (await probeLatestAsset())
}

async function fileIsValid(file: string) {
  try {
    const info = await stat(file)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

function isUpToDate(remote: RemoteDatabase, version: GeoIpVersionRecord | null) {
  if (!version) return false
  if (remote.tag && version.tag && remote.tag === version.tag) return true
  if (remote.tag || !remote.etag || version.etag !== remote.etag) return false
  if (remote.size && version.size !== remote.size) return false
  const age = Date.now() - Date.parse(version.downloadedAt)
  return Number.isFinite(age) && age >= 0 && age < ETAG_TRUST_MS
}

async function downloadAndHash(url: string, destination: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15 * 60_000),
  })
  if (!response.ok || !response.body)
    throw new Error("下载数据库失败：HTTP " + response.status)

  const hash = createHash("sha256")
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    meter,
    createWriteStream(destination, { flags: "wx" }),
  )
  return { sha256: hash.digest("hex"), size: received }
}

/** 固定的抽查样本：覆盖美区、中国区与 IPv6，任一失败即视为数据不可信。 */
const SAMPLE_CHECKS = [
  { ip: "8.8.8.8", country: "US" },
  { ip: "114.114.114.114", country: "CN" },
  { ip: "2001:4860:b002::68", country: "US" },
] as const

async function verifyDatabaseFile(file: string, log: Logger) {
  const reader = new Reader<CityResponse>(await readFile(file))
  const metadata = reader.metadata
  if (metadata.ipVersion !== 6)
    throw new Error("数据库不支持 IPv6，疑似不是合并库")
  if (metadata.nodeCount < 1_000_000)
    throw new Error("数据库节点数异常（" + metadata.nodeCount + "），疑似残缺文件")

  const buildAge = Date.now() - metadata.buildEpoch.getTime()
  if (buildAge < -24 * 60 * 60 * 1000)
    throw new Error("数据库构建时间在未来，拒绝安装")
  if (buildAge > 30 * 24 * 60 * 60 * 1000)
    log("注意：数据库构建时间已超过 30 天，上游可能停止更新。")

  for (const sample of SAMPLE_CHECKS) {
    const result = reader.get(sample.ip)
    if (!result) throw new Error("抽查 " + sample.ip + " 无结果，拒绝安装")
    const country =
      result.country?.iso_code ?? result.registered_country?.iso_code ?? null
    if (country !== sample.country)
      throw new Error(
        "抽查 " + sample.ip + " 国家为 " + country + "，期望 " + sample.country,
      )
  }
  return {
    databaseType: metadata.databaseType,
    buildEpoch: metadata.buildEpoch,
    nodeCount: metadata.nodeCount,
  }
}

async function acquireLock(lockPath: string) {
  const attempt = async () => {
    const handle = await open(lockPath, "wx")
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    )
    await handle.close()
  }
  try {
    await attempt()
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const info = await stat(lockPath).catch(() => null)
    if (info && Date.now() - info.mtimeMs < LOCK_STALE_MS) return false
    await rm(lockPath, { force: true })
    await attempt()
    return true
  }
}

async function pruneBackups(backupRoot: string) {
  const entries = await readdir(backupRoot, { withFileTypes: true }).catch(
    () => [],
  )
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
  for (const name of directories.slice(KEPT_BACKUPS)) {
    await rm(path.join(backupRoot, name), { recursive: true, force: true })
  }
}

async function writeVersionRecord(record: GeoIpVersionRecord) {
  const versionPath = getGeoIpVersionPath()
  const temporary = versionPath + "." + process.pid + ".new"
  await writeFile(temporary, JSON.stringify(record, null, 2) + "\n")
  await rename(temporary, versionPath)
}

/**
 * 检查并（必要时）安装最新合并库。可安全地重复调用：
 * 已是最新版、或另一个进程正在更新时直接返回。
 */
export async function updateGeoIpDatabase({
  log = (message: string) => console.log(message),
}: { log?: Logger } = {}): Promise<GeoIpUpdateResult> {
  const dataDir = getGeoIpDataDir()
  await mkdir(dataDir, { recursive: true })

  const lockPath = path.join(dataDir, "update.lock")
  if (!(await acquireLock(lockPath))) {
    return { status: "skipped", reason: "另一个 GeoIP 更新任务正在运行" }
  }

  const stagedPath = path.join(
    dataDir,
    GEOIP_DATABASE_FILENAME + "." + process.pid + ".download",
  )
  try {
    const databasePath = getGeoIpDatabasePath()
    const version = readGeoIpVersion()
    const remote = await resolveRemoteDatabase()

    if ((await fileIsValid(databasePath)) && isUpToDate(remote, version)) {
      const label = remote.tag ?? version?.tag ?? version?.sha256.slice(0, 12)
      log("GeoIP 数据库已是最新（" + (label ?? "未知标识") + "），跳过下载。")
      return {
        status: "up-to-date",
        tag: remote.tag ?? version?.tag ?? null,
        sha256: version?.sha256 ?? null,
        downloadedAt: version?.downloadedAt ?? null,
      }
    }

    await rm(stagedPath, { force: true })
    log("下载 " + GEOIP_DATABASE_FILENAME + "（约 96MB）…")
    const downloaded = await downloadAndHash(remote.assetUrl, stagedPath)

    if (
      downloaded.size < MIN_DATABASE_BYTES ||
      downloaded.size > MAX_DATABASE_BYTES
    ) {
      throw new Error(
        "下载文件大小异常（" + downloaded.size + " 字节），拒绝安装",
      )
    }
    if (remote.size && downloaded.size !== remote.size)
      throw new Error(
        "下载长度与响应头不一致（" +
          downloaded.size +
          "/" +
          remote.size +
          "），拒绝安装",
      )
    if (remote.digest && downloaded.sha256 !== remote.digest)
      throw new Error("SHA-256 与 GitHub Release 元数据不一致，拒绝安装")

    const metadata = await verifyDatabaseFile(stagedPath, log)

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupDir = path.join(process.cwd(), ".backups", "geoip", timestamp)
    const backupFile = path.join(backupDir, GEOIP_DATABASE_FILENAME)
    const hasPrevious = await fileIsValid(databasePath)

    releaseGeoIpReader()
    if (hasPrevious) {
      await mkdir(backupDir, { recursive: true })
      await rename(databasePath, backupFile)
    }
    try {
      await rename(stagedPath, databasePath)
    } catch (error) {
      if (hasPrevious) await rename(backupFile, databasePath)
      releaseGeoIpReader()
      throw error
    }

    if (!loadGeoIpReader()) {
      releaseGeoIpReader()
      await rm(databasePath, { force: true })
      if (hasPrevious) await rename(backupFile, databasePath)
      loadGeoIpReader()
      throw new Error("新数据库无法加载，已回滚到上一版本")
    }

    const record: GeoIpVersionRecord = {
      source: GEOIP_SOURCE_URL,
      tag: remote.tag,
      publishedAt: remote.publishedAt,
      etag: remote.etag,
      sha256: downloaded.sha256,
      size: downloaded.size,
      downloadedAt: new Date().toISOString(),
    }
    await writeVersionRecord(record)
    if (hasPrevious) await pruneBackups(path.dirname(backupDir))

    log(
      "GeoIP 数据库已更新：" +
        (remote.tag ?? remote.etag ?? "latest") +
        "（构建于 " +
        metadata.buildEpoch.toISOString() +
        "，" +
        Math.round(downloaded.size / 1024 / 1024) +
        "MB）。",
    )
    return { status: "updated", version: record, databasePath }
  } finally {
    await rm(stagedPath, { force: true })
    await rm(lockPath, { force: true })
  }
}

const schedulerKey = Symbol.for("custodysim.geoip-update-scheduler")

/** 应用内周更调度：与部署脚本共用 GEOIP_AUTO_UPDATE 开关。 */
export function startGeoIpUpdateScheduler() {
  if (process.env.GEOIP_AUTO_UPDATE !== "true") return
  startIntervalScheduler({
    key: schedulerKey,
    intervalMs: GEOIP_UPDATE_INTERVAL_MS,
    label: "geoip",
    run: () => updateGeoIpDatabase(),
  })
}
