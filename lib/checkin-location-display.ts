function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function ipLocationText(label: string) {
  return `IP 粗略定位（Merged-IP 数据：GeoLite2 by MaxMind、IP Geolocation by DB-IP）：${label}`
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
  const ipLabel = text(object(record.ipLocation)?.label) ?? text(savedIp?.label)
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
