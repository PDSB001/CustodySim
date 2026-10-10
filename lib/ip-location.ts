import geoip from "geoip-lite"

export type IpCoarseLocation = {
  source: "IP"
  precision: "CITY"
  label: string
  country: string | null
  region: string | null
  city: string | null
  timezone: string | null
}

function normalizeIp(value: string | null | undefined) {
  if (!value) return null
  return value.replace(/^::ffff:/, "").trim() || null
}

export function getCoarseIpLocation(
  ip: string | null | undefined,
): IpCoarseLocation {
  const normalizedIp = normalizeIp(ip)
  const result = normalizedIp ? geoip.lookup(normalizedIp) : null
  const country = result?.country ?? null
  const region = result?.region ?? null
  const city = result?.city ?? null
  const label = [city, region, country].filter(Boolean).join(" · ")
  return {
    source: "IP",
    precision: "CITY",
    label: label || "IP 粗略定位暂不可用",
    country,
    region,
    city,
    timezone: result?.timezone ?? null,
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
