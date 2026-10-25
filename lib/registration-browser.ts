import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"
import { assertUsableSecret } from "@/lib/secret-guard"

export const REGISTRATION_BROWSER_COOKIE = "custodysim_registration_browser"
export const REGISTRATION_DEVICE_LIMIT = 2
export const REGISTRATION_DEVICE_WINDOW_MS = 86400_000
export type RegistrationRisk = {
  deviceHash: string
  networkHash: string | null
}
function digest(value: string) {
  return createHmac(
    "sha256",
    assertUsableSecret("AUTH_SECRET", process.env.AUTH_SECRET),
  )
    .update(`registration-risk:v1:${value}`)
    .digest("hex")
}
export function registrationBrowserCookie(existing?: string): string {
  return browserHash(existing)
    ? existing!
    : (() => {
        const id = randomBytes(32).toString("hex")
        return `${id}.${digest(`cookie:${id}`)}`
      })()
}
export function browserHash(cookie?: string): string | null {
  if (!cookie || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(cookie)) return null
  const [id, signature] = cookie.split(".")
  if (
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(digest(`cookie:${id}`), "hex"),
    )
  )
    return null
  return digest(`device:${id}`)
}
/** Canonical IPv4 /32 and IPv6 /64: alternative IPv6 spellings cannot reset quotas. */
export function registrationNetwork(value: string | null): string | null {
  if (!value) return null
  let ip = value.split("%")[0].toLowerCase()
  const family = isIP(ip)
  if (!family) return null
  if (family === 4) return `v4:${ip}`
  if (ip.includes(".")) {
    const split = ip.lastIndexOf(":")
    const bytes = ip
      .slice(split + 1)
      .split(".")
      .map(Number)
    ip = `${ip.slice(0, split)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
  }
  const halves = ip.split("::")
  const left = halves[0]
    ? halves[0].split(":").map((part) => parseInt(part, 16))
    : []
  const right = halves[1]
    ? halves[1].split(":").map((part) => parseInt(part, 16))
    : []
  const words =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
      : left
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff)
    return `v4:${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
  return `v6:${words
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(":")}/64`
}
export function registrationRisk(
  cookie: string | undefined,
  ip: string | null,
): RegistrationRisk | null {
  const deviceHash = browserHash(cookie)
  if (!deviceHash) return null
  const network = registrationNetwork(ip)
  return {
    deviceHash,
    networkHash: network ? digest(`network:${network}`) : null,
  }
}
