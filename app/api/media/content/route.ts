import { GET as chatImage } from "@/app/api/chat/messages/[id]/image/route"
import { GET as bookCover } from "@/app/api/library/[id]/cover/route"
import { GET as bookFile } from "@/app/api/library/[id]/file/route"
import { GET as bookResource } from "@/app/api/library/[id]/resource/route"
import { communityImage } from "@/lib/community-server"
import { MEDIA_PERMIT_HEADER, verifyMediaPermit } from "@/lib/edgeone-media"
import { getMediaRevision } from "@/lib/edgeone-media-access"
import { parseCachedMedia } from "@/lib/media-cache-path"
import { getSessionUser } from "@/lib/session"

const noStore = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
}

/** The edge's 30s permit is not a login credential; current session/scope is required again. */
export async function GET(request: Request) {
  try {
    const permit = verifyMediaPermit(
      request.headers.get(MEDIA_PERMIT_HEADER) ?? "",
    )
    if (!permit) return new Response(null, { status: 403, headers: noStore })
    const actor = await getSessionUser()
    if (!actor || actor.id !== permit.userId)
      return new Response(null, { status: 403, headers: noStore })
    const media = parseCachedMedia(permit.target)!
    const revision = await getMediaRevision(actor, media)
    if (revision === null || revision !== permit.revision)
      return new Response(null, { status: 404, headers: noStore })
    const context = { params: Promise.resolve({ id: media.id }) }
    const resourceRequest = new Request(new URL(media.target, request.url), {
      headers: request.headers,
    })
    const response =
      media.kind === "chat"
        ? await chatImage(request, context)
        : media.kind === "cover"
          ? await bookCover(request, context)
          : media.kind === "book"
            ? await bookFile(resourceRequest, context)
            : media.kind === "resource"
              ? await bookResource(resourceRequest, context)
              : await communityImage(media.id)
    if (
      response.status === 200 &&
      revision !== "legacy" &&
      ((await getMediaRevision(actor, media)) !== revision ||
        ((media.kind === "book" || media.kind === "resource") &&
          response.headers.get("X-CustodySim-Book-Revision") !== revision))
    ) {
      await response.body?.cancel()
      return new Response(null, { status: 404, headers: noStore })
    }
    const headers = new Headers(response.headers)
    headers.set("Cache-Control", "private, no-store")
    headers.set("Vary", "Cookie, Authorization")
    headers.set("X-CustodySim-Media-Revision", revision)
    return new Response(response.body, { status: response.status, headers })
  } catch {
    console.error("[edgeone-media] content unavailable")
    return new Response(null, { status: 503, headers: noStore })
  }
}
