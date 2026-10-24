import { readFileSync } from "node:fs"
import path from "node:path"

import { Reader } from "maxmind"
import type { CityResponse } from "maxmind"

/**
 * 本地 IP 库的落盘位置。
 *
 * 放在仓库内的 `data/geoip`（已 gitignore）而不是 `node_modules`：
 * `pnpm install` 会重建 node_modules，之前放在 geoip-lite 包内的数据会被清掉；
 * 数据库独立于依赖树后，安装、构建、更新三者互不影响。
 *
 * 生产用 PM2 从仓库根目录启动 `.next/standalone/server.js`，`process.cwd()`
 * 就是仓库根目录；需要别的目录时用 `GEOIP_DATA_DIR` 覆盖。
 */
export const GEOIP_DATABASE_FILENAME = "Merged-IP.mmdb"
export const GEOIP_VERSION_FILENAME = "version.json"

export type GeoIpVersionRecord = {
  source: string
  tag: string | null
  publishedAt: string | null
  etag: string | null
  sha256: string
  size: number
  downloadedAt: string
}

export function getGeoIpDataDir() {
  const configured = process.env.GEOIP_DATA_DIR?.trim()
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "geoip")
}

export function getGeoIpDatabasePath() {
  return path.join(getGeoIpDataDir(), GEOIP_DATABASE_FILENAME)
}

export function getGeoIpVersionPath() {
  return path.join(getGeoIpDataDir(), GEOIP_VERSION_FILENAME)
}

const readerKey = Symbol.for("custodysim.geoip-reader")

type GeoIpReaderStore = {
  reader: Reader<CityResponse> | null
  /** 文件缺失或损坏时记住失败，避免每个请求都去读一次磁盘。 */
  unavailable: boolean
}

function readerStore(): GeoIpReaderStore {
  const runtime = globalThis as typeof globalThis & {
    [readerKey]?: GeoIpReaderStore
  }
  runtime[readerKey] ??= { reader: null, unavailable: false }
  return runtime[readerKey]
}

/**
 * 同步取用 mmdb 读取器。`Reader.get` 本身是同步的，只有加载整份文件是 I/O；
 * 这里首次调用时读入并缓存（约 96MB 常驻），之后每次查询都走内存树。
 */
export function loadGeoIpReader(): Reader<CityResponse> | null {
  const store = readerStore()
  if (store.reader) return store.reader
  if (store.unavailable) return null
  try {
    store.reader = new Reader<CityResponse>(readFileSync(getGeoIpDatabasePath()))
    return store.reader
  } catch (error) {
    store.unavailable = true
    console.warn(
      "[geoip] 本地数据库不可用，IP 定位将降级为占位文案：",
      getGeoIpDatabasePath(),
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/** 释放已加载的数据库，下次查询会重新读盘（用于数据更新后热切换）。 */
export function releaseGeoIpReader() {
  const store = readerStore()
  store.reader = null
  store.unavailable = false
}

export function describeGeoIpDatabase() {
  const reader = loadGeoIpReader()
  if (!reader) return { path: getGeoIpDatabasePath(), available: false } as const
  return {
    path: getGeoIpDatabasePath(),
    available: true,
    databaseType: reader.metadata.databaseType,
    buildEpoch: reader.metadata.buildEpoch,
    ipVersion: reader.metadata.ipVersion,
    nodeCount: reader.metadata.nodeCount,
  } as const
}

/** 上次成功更新写入的版本记录；缺失或损坏时返回 null。 */
export function readGeoIpVersion(): GeoIpVersionRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(getGeoIpVersionPath(), "utf8"),
    ) as Partial<GeoIpVersionRecord>
    if (
      typeof parsed.sha256 !== "string" ||
      typeof parsed.size !== "number" ||
      typeof parsed.downloadedAt !== "string"
    ) {
      return null
    }
    return {
      source: typeof parsed.source === "string" ? parsed.source : "",
      tag: typeof parsed.tag === "string" && parsed.tag ? parsed.tag : null,
      publishedAt:
        typeof parsed.publishedAt === "string" && parsed.publishedAt
          ? parsed.publishedAt
          : null,
      etag:
        typeof parsed.etag === "string" && parsed.etag ? parsed.etag : null,
      sha256: parsed.sha256,
      size: parsed.size,
      downloadedAt: parsed.downloadedAt,
    }
  } catch {
    return null
  }
}
