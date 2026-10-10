const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const paths = [
  ["chat", new RegExp(`^/api/chat/messages/(${uuid})/image$`)],
  ["cover", new RegExp(`^/api/library/(${uuid})/cover$`)],
  ["community", new RegExp(`^/api/community/images/(${uuid})$`)],
] as const

export type CachedMedia = {
  kind: "chat" | "cover" | "community"
  id: string
  pathname: string
}

/** Only existing same-origin image paths; never accept a URL to fetch from the caller. */
export function parseCachedMedia(target: string): CachedMedia | null {
  if (!target.startsWith("/api/") || target.length > 200) return null
  const url = new URL(target, "https://media.invalid")
  if (url.origin !== "https://media.invalid" || url.hash) return null
  for (const [kind, pattern] of paths) {
    const match = pattern.exec(url.pathname)
    if (!match) continue
    const entries = [...url.searchParams.entries()]
    if (
      entries.length &&
      (kind !== "cover" ||
        entries.length !== 1 ||
        entries[0][0] !== "v" ||
        !/^\d{1,16}$/.test(entries[0][1]))
    )
      return null
    return { kind, id: match[1], pathname: url.pathname }
  }
  return null
}
