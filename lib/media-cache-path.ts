const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const paths = [
  ["chat", new RegExp(`^/api/chat/messages/(${uuid})/image$`)],
  ["cover", new RegExp(`^/api/library/(${uuid})/cover$`)],
  ["community", new RegExp(`^/api/community/images/(${uuid})$`)],
  ["book", new RegExp(`^/api/library/(${uuid})/file$`)],
  ["resource", new RegExp(`^/api/library/(${uuid})/resource$`)],
] as const

export type CachedMedia = {
  kind: "chat" | "cover" | "community" | "book" | "resource"
  id: string
  pathname: string
  target: string
}

/** Only allowlisted same-origin resources; never accept a fetch URL from the caller. */
export function parseCachedMedia(target: string): CachedMedia | null {
  if (!target.startsWith("/api/") || target.length > 4096) return null
  const url = new URL(target, "https://media.invalid")
  if (url.origin !== "https://media.invalid" || url.hash) return null
  for (const [kind, pattern] of paths) {
    const match = pattern.exec(url.pathname)
    if (!match) continue
    const entries = [...url.searchParams.entries()]
    if (kind === "resource") {
      const path = url.searchParams.get("path")
      if (
        entries.length !== 1 ||
        entries[0][0] !== "path" ||
        !path ||
        path.length > 1000 ||
        /[\\\u0000-\u001f]/.test(path) ||
        path.startsWith("/") ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        return null
      return {
        kind,
        id: match[1],
        pathname: url.pathname,
        target: `${url.pathname}?path=${encodeURIComponent(path)}`,
      }
    }
    if (
      entries.length &&
      (kind !== "cover" ||
        entries.length !== 1 ||
        entries[0][0] !== "v" ||
        !/^\d{1,16}$/.test(entries[0][1]))
    )
      return null
    return { kind, id: match[1], pathname: url.pathname, target: url.pathname }
  }
  return null
}
