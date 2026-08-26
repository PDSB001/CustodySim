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
