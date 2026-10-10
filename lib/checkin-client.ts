/** Client metadata is descriptive and never participates in authorization. */
export function getCheckinClientInfo(record: {
  clientType?: string | null
  browserType?: string | null
  userAgent?: string | null
}) {
  const userAgent = record.userAgent ?? record.browserType ?? null
  const app =
    record.clientType === "APP" ||
    record.clientType === "ANDROID" ||
    /^okhttp(?:\/|\s|$)/i.test(userAgent?.trim() ?? "")
  const clientType =
    record.clientType === "SYSTEM"
      ? "SYSTEM"
      : app
        ? "APP"
        : (record.clientType ?? (userAgent ? "WEB" : null))
  const browsers: Array<[RegExp, string]> = [
    [/(?:Edg|EdgA|EdgiOS)\/([\d.]+)/, "Edge"],
    [/(?:OPR|OPiOS)\/([\d.]+)/, "Opera"],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/(?:Firefox|FxiOS)\/([\d.]+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari\//, "Safari"],
  ]
  let browserName: string | null = null
  if (clientType === "WEB") {
    for (const [pattern, name] of browsers) {
      const match = pattern.exec(userAgent ?? "")
      if (match) {
        browserName = `${name} ${match[1]}`
        break
      }
    }
  }
  return {
    clientType,
    label:
      clientType === "APP"
        ? "App"
        : clientType === "SYSTEM"
          ? "系统"
          : clientType === "WEB"
            ? "网页端"
            : (clientType ?? "客户端未记录"),
    browserName,
    userAgent,
  }
}
