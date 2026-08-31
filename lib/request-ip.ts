import { isIP } from "node:net"

export function getRequestIp(headers: Headers) {
  const trustProxy =
    process.env.NODE_ENV !== "production" || process.env.TRUST_PROXY === "true"
  if (!trustProxy) return null
  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp && isIP(realIp)) return realIp
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const nearestClient = forwarded?.at(-1)
  return nearestClient && isIP(nearestClient) ? nearestClient : null
}
