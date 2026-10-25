function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const countryNames = new Intl.DisplayNames(["zh-CN"], {
  type: "region",
  style: "short",
})
const englishCountryNames = new Intl.DisplayNames(["en"], {
  type: "region",
  style: "short",
})

/** Shared by the current check-in card and history; never replaces saved data. */
export function formatIpLocationLabel(value: unknown): string | null {
  const location = object(value)
  if (!location) return null
  const city = text(location.city)
  const region = text(location.region)
  const label = text(location.label)
  const legacyParts = label?.split(/\s*·\s*/)
  const legacyCountry =
    legacyParts && legacyParts.length > 1 ? legacyParts.at(-1) : null
  const country =
    text(location.country) ??
    (legacyCountry && /^[A-Z]{2}$/.test(legacyCountry) ? legacyCountry : null)
  const countryName =
    country && /^[A-Z]{2}$/.test(country)
      ? (countryNames.of(country) ?? country)
      : country
  const cityName =
    country &&
    /^[A-Z]{2}$/.test(country) &&
    city === englishCountryNames.of(country)
      ? countryName
      : city
  const regionName = region && !/^[A-Z0-9-]{1,3}$/.test(region) ? region : null
  const parts =
    cityName || regionName
      ? [cityName, regionName, countryName]
      : label && label !== "IP 粗略定位暂不可用"
        ? legacyParts!.map((part) => {
            if (part === country) return countryName
            if (part === region && !regionName) return null
            return part
          })
        : [countryName]
  const seen = new Set<string>()
  const unique = parts.filter((part): part is string => {
    if (!part) return false
    const key = part.trim().toLocaleLowerCase("zh-CN")
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.join(" · ") || null
}

function ipLocationText(label: string) {
  return `IP 粗略定位：${label}`
}

/** Supports both existing snapshots and the server's parsed IP metadata. */
export function getCheckinLocationText(record: {
  locationSource: string
  location?: unknown
  ipLocation?: unknown
  ip?: string | null
  lat?: string | null
  lng?: string | null
}) {
  const location = object(record.location)
  const savedIp =
    record.locationSource === "IP" ? location : object(location?.ip)
  const ipLabel =
    formatIpLocationLabel(record.ipLocation) ?? formatIpLocationLabel(savedIp)
  if (record.locationSource === "GPS_PURGED") {
    return ipLabel
      ? `${ipLocationText(ipLabel)} · GPS 坐标已按保留策略清除`
      : "地点已按保留策略清除（GPS 保留 3 天）"
  }
  if (record.locationSource === "SYSTEM") return null
  if (record.locationSource === "GPS") {
    const address = text(location?.address) ?? text(location?.label)
    const coordinates =
      record.lat && record.lng ? `${record.lat}, ${record.lng}` : null
    return (
      [address, coordinates, ipLabel ? ipLocationText(ipLabel) : null]
        .filter(Boolean)
        .join(" · ") || null
    )
  }
  return (
    (ipLabel ? ipLocationText(ipLabel) : null) ??
    text(location?.address) ??
    text(location?.label) ??
    (record.ip ? `IP ${record.ip}` : null)
  )
}
