import { loadGeoIpReader } from "@/lib/geoip-database"
import type { CityResponse } from "maxmind"

export type IpCoarseLocation = {
  source: "IP"
  precision: "CITY"
  label: string
  country: string | null
  region: string | null
  city: string | null
  timezone: string | null
}

const UNAVAILABLE_LABEL = "IP 粗略定位暂不可用"

function normalizeIp(value: string | null | undefined) {
  if (!value) return null
  return value.replace(/^::ffff:/, "").trim() || null
}

/** 多语言名称优先中文，回落英文；没有名称时返回 null。 */
function pickName(names: { readonly en: string; readonly "zh-CN"?: string } | undefined) {
  if (!names) return null
  return names["zh-CN"]?.trim() || names.en?.trim() || null
}

/**
 * 把 mmdb 查询结果收敛成城市级字段。
 *
 * 只保留国家代码、一级行政区、城市与时区：经纬度、邮编、ASN、代理标记一律
 * 不外泄，避免粗定位变成可识别个人的精确坐标。
 */
export function ipLocationFromResponse(
  result: CityResponse | null | undefined,
): IpCoarseLocation {
  const country =
    result?.country?.iso_code?.trim() ||
    result?.registered_country?.iso_code?.trim() ||
    null
  const city = pickName(result?.city?.names)
  const region = pickName(result?.subdivisions?.[0]?.names)
  const timezone = result?.location?.time_zone?.trim() || null
  const label = [city, region, country].filter(Boolean).join(" · ")
  return {
    source: "IP",
    precision: "CITY",
    label: label || UNAVAILABLE_LABEL,
    country,
    region,
    city,
    timezone,
  }
}

export function getCoarseIpLocation(
  ip: string | null | undefined,
): IpCoarseLocation {
  const normalizedIp = normalizeIp(ip)
  const reader = normalizedIp ? loadGeoIpReader() : null
  if (!normalizedIp || !reader) return ipLocationFromResponse(null)
  try {
    return ipLocationFromResponse(reader.get(normalizedIp))
  } catch {
    // 非法 IP 字符串由 mmdb-lib 抛错，按"定位不可用"处理，不影响打卡本身。
    return ipLocationFromResponse(null)
  }
}

/** Prefer the check-in-time snapshot; resolve missing legacy metadata locally. */
export function getRecordIpLocation(record: {
  locationSource: string
  location: unknown
  ip: string | null
}): IpCoarseLocation | null {
  if (record.locationSource === "SYSTEM") return null
  const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  const location = object(record.location)
  const cached =
    record.locationSource === "IP" ? location : object(location?.ip)
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null
  if (
    cached &&
    text(cached.label) &&
    (text(cached.country) || text(cached.region) || text(cached.city))
  ) {
    return {
      source: "IP",
      precision: "CITY",
      label: text(cached.label)!,
      country: text(cached.country),
      region: text(cached.region),
      city: text(cached.city),
      timezone: text(cached.timezone),
    }
  }
  return record.ip ? getCoarseIpLocation(record.ip) : null
}
