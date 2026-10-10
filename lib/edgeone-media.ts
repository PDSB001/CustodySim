import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { assertUsableSecret } from "@/lib/secret-guard"
import { parseCachedMedia, type CachedMedia } from "@/lib/media-cache-path"

export const MEDIA_PERMIT_HEADER = "x-custodysim-media-permit"
const PERMIT_TTL_SECONDS = 30
const PermitSchema = z.object({
  purpose: z.literal("edgeone-media-origin-v1"),
  userId: z.string().uuid(),
  target: z.string().max(200),
  revision: z.string().regex(/^(?:0|legacy|\d{13,16})$/),
  expiresAt: z.number().int(),
})
export type MediaPermit = z.infer<typeof PermitSchema>

/** Off by default. Invalid enabled configuration fails closed, without affecting old routes. */
export function edgeMediaEnabled() {
  if (process.env.EDGEONE_MEDIA_CACHE_ENABLED !== "true") return false
  const key = assertUsableSecret(
    "EDGEONE_MEDIA_SIGNING_KEY",
    process.env.EDGEONE_MEDIA_SIGNING_KEY,
  )
  if (key === process.env.AUTH_SECRET)
    throw new Error("EDGEONE_MEDIA_SIGNING_KEY 必须独立于 AUTH_SECRET")
  return true
}

function signature(payload: string) {
  return createHmac("sha256", process.env.EDGEONE_MEDIA_SIGNING_KEY!)
    .update(payload)
    .digest()
}

export function signMediaPermit(
  userId: string,
  media: CachedMedia,
  revision: string,
  now = Date.now(),
) {
  if (!edgeMediaEnabled()) throw new Error("EdgeOne media cache is disabled")
  const payload = Buffer.from(
    JSON.stringify(
      PermitSchema.parse({
        purpose: "edgeone-media-origin-v1",
        userId,
        target: media.pathname,
        revision,
        expiresAt: Math.floor(now / 1000) + PERMIT_TTL_SECONDS,
      }),
    ),
  ).toString("base64url")
  return `${payload}.${signature(payload).toString("base64url")}`
}

export function verifyMediaPermit(
  token: string,
  now = Date.now(),
): MediaPermit | null {
  if (!edgeMediaEnabled() || token.length > 1000) return null
  const parts = token.split(".")
  if (
    parts.length !== 2 ||
    !/^[\w-]+$/.test(parts[0]) ||
    !/^[\w-]{43}$/.test(parts[1])
  )
    return null
  const expected = signature(parts[0])
  const actual = Buffer.from(parts[1], "base64url")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null
  try {
    const result = PermitSchema.safeParse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    )
    const seconds = Math.floor(now / 1000)
    if (
      !result.success ||
      result.data.expiresAt <= seconds ||
      result.data.expiresAt > seconds + PERMIT_TTL_SECONDS ||
      !parseCachedMedia(result.data.target)
    )
      return null
    return result.data
  } catch {
    return null
  }
}
