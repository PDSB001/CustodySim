import { and, eq, gte, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { chatMessages, communityImages, libraryBooks } from "@/lib/db/schema"
import { getChatConversationAccess } from "@/lib/chat-server"
import { retentionCutoff } from "@/lib/chat"
import type { CachedMedia } from "@/lib/media-cache-path"
import type { SessionUser } from "@/lib/session"

/** Metadata only: no picture/base64/book blob is selected on a cache hit. */
export async function getMediaRevision(actor: SessionUser, media: CachedMedia) {
  if (media.kind === "chat") {
    const [row] = await db
      .select({ conversationId: chatMessages.conversationId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, media.id),
          eq(chatMessages.type, "IMAGE"),
          isNull(chatMessages.recalledAt),
          gte(chatMessages.createdAt, retentionCutoff(actor.role)),
        ),
      )
      .limit(1)
    return row && (await getChatConversationAccess(actor, row.conversationId))
      ? "0"
      : null
  }
  if (media.kind === "community") {
    const [row] = await db
      .select({ id: communityImages.id })
      .from(communityImages)
      .where(eq(communityImages.id, media.id))
      .limit(1)
    return row ? "0" : null
  }
  const [row] = await db
    .select({
      enabled: libraryBooks.enabled,
      format: libraryBooks.format,
      coverAvailable: sql<boolean>`${libraryBooks.coverBytes} is not null`,
      coverUpdatedAt: libraryBooks.coverUpdatedAt,
    })
    .from(libraryBooks)
    .where(and(eq(libraryBooks.id, media.id), isNull(libraryBooks.deletedAt)))
    .limit(1)
  if (!row || (!row.enabled && actor.role !== "ADMIN")) return null
  if (row.coverAvailable)
    return row.coverUpdatedAt?.getTime().toString() ?? "legacy"
  // The existing route lazily imports older EPUB/DOCX covers. Never cache that first response.
  return !row.coverUpdatedAt && ["EPUB", "DOCX"].includes(row.format)
    ? "legacy"
    : null
}
