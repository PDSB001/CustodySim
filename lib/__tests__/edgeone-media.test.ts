import { randomUUID } from "node:crypto"
import { afterEach, expect, test, vi } from "vitest"
import {
  edgeMediaEnabled,
  signMediaPermit,
  verifyMediaPermit,
} from "@/lib/edgeone-media"
import { parseCachedMedia } from "@/lib/media-cache-path"

const id = randomUUID()
const user = randomUUID()
const path = `/api/chat/messages/${id}/image`
const media = parseCachedMedia(path)!
const key = "d17492cfe3b08569".repeat(4)
function enable() {
  vi.stubEnv("EDGEONE_MEDIA_CACHE_ENABLED", "true")
  vi.stubEnv("EDGEONE_MEDIA_SIGNING_KEY", key)
}
afterEach(() => vi.unstubAllEnvs())

test("disabled by default; enabled configuration requires an independent real signing key", () => {
  vi.stubEnv("EDGEONE_MEDIA_CACHE_ENABLED", "false")
  expect(edgeMediaEnabled()).toBe(false)
  vi.stubEnv("EDGEONE_MEDIA_CACHE_ENABLED", "true")
  vi.stubEnv("EDGEONE_MEDIA_SIGNING_KEY", "")
  expect(() => edgeMediaEnabled()).toThrow()
  vi.stubEnv(
    "EDGEONE_MEDIA_SIGNING_KEY",
    "replace-this-with-a-long-placeholder",
  )
  expect(() => edgeMediaEnabled()).toThrow()
  enable()
  vi.stubEnv("AUTH_SECRET", key)
  expect(() => edgeMediaEnabled()).toThrow(/独立/)
})

test("30s permits bind the user, canonical image path and authoritative version", () => {
  enable()
  const now = 1_800_000_000_000
  const permit = signMediaPermit(user, media, "0", now)
  expect(verifyMediaPermit(permit, now)).toMatchObject({
    userId: user,
    target: path,
    revision: "0",
  })
  expect(verifyMediaPermit(permit, now + 29_000)).not.toBeNull()
  expect(verifyMediaPermit(permit, now + 30_000)).toBeNull()
  expect(verifyMediaPermit(permit, now - 1_000)).toBeNull()
  const [payload, signature] = permit.split(".")
  const altered = JSON.parse(Buffer.from(payload, "base64url").toString())
  altered.userId = randomUUID()
  expect(
    verifyMediaPermit(
      `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`,
      now,
    ),
  ).toBeNull()
  expect(verifyMediaPermit(`${permit}.extra`, now)).toBeNull()
  vi.stubEnv("EDGEONE_MEDIA_SIGNING_KEY", "a91758d26fe340cb".repeat(4))
  expect(verifyMediaPermit(permit, now)).toBeNull()
})

test("media allowlist excludes documents, proxy targets and ambiguous parameters", () => {
  expect(
    parseCachedMedia(`/api/library/${id}/cover?v=1800000000000`),
  ).toMatchObject({ kind: "cover", id })
  expect(parseCachedMedia(`/api/community/images/${id}`)).toMatchObject({
    kind: "community",
    id,
  })
  for (const target of [
    `https://other.test${path}`,
    `//other.test${path}`,
    `${path}?token=anything`,
    `/api/library/${id}/document`,
    `/api/library/${id}/content`,
    `/api/library/${id}/file?v=1`,
    `/api/library/${id}/cover?v=1&v=2`,
    `/api/library/${id}/cover?v=abc`,
    `/api/media/content`,
    `${path}#fragment`,
  ])
    expect(parseCachedMedia(target)).toBeNull()
})

test("book files and EPUB resource permits bind the complete canonical path", () => {
  enable()
  const file = parseCachedMedia(`/api/library/${id}/file`)!
  expect(file.kind).toBe("book")
  const path = `/api/library/${id}/resource`
  const resource = parseCachedMedia(`${path}?path=OPS%2Fimages%2Fa%20b.png`)!
  expect(resource.kind).toBe("resource")
  const revision = "1a2b3c4d".repeat(3)
  const permit = signMediaPermit(user, resource, revision)
  expect(verifyMediaPermit(permit)?.target).toBe(resource.target)
  expect(verifyMediaPermit(permit)?.revision).toBe(revision)
  for (const query of [
    "",
    "path=",
    "path=../a.png",
    "path=%2Fa.png",
    "path=OPS%5Cimage.png",
    "path=OPS%00image.png",
    "path=a.png&path=b.png",
    "path=a.png&token=foo",
    "path=OPS//a.png",
  ])
    expect(parseCachedMedia(`${path}?${query}`)).toBeNull()
})
