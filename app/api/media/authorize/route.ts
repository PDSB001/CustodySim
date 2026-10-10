import { edgeMediaEnabled, signMediaPermit } from "@/lib/edgeone-media"
import { getMediaRevision } from "@/lib/edgeone-media-access"
import { parseCachedMedia } from "@/lib/media-cache-path"
import { getSessionUser } from "@/lib/session"

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
}

export async function GET(request: Request) {
  try {
    // A deployed function can safely revert to the original authenticated routes when disabled.
    if (!edgeMediaEnabled()) return new Response(null, { status: 204, headers })
    const actor = await getSessionUser()
    if (!actor) return new Response(null, { status: 401, headers })
    const media = parseCachedMedia(
      new URL(request.url).searchParams.get("target") ?? "",
    )
    if (!media) return new Response(null, { status: 404, headers })
    const revision = await getMediaRevision(actor, media)
    if (revision === null) return new Response(null, { status: 404, headers })
    return Response.json(
      {
        kind: media.kind,
        id: media.id,
        revision,
        permit: signMediaPermit(actor.id, media, revision),
        cacheable: revision !== "legacy",
      },
      { headers },
    )
  } catch {
    // Never log credentials, permits or the configured signing key.
    console.error("[edgeone-media] authorization unavailable")
    return new Response(null, { status: 503, headers })
  }
}
