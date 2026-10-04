import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { failure } from "@/lib/api-response"
import { importEbook } from "@/lib/ebook-import"

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const [book] = await db
    .select({
      coverBytes: libraryBooks.coverBytes,
      coverMime: libraryBooks.coverMime,
      coverUpdatedAt: libraryBooks.coverUpdatedAt,
      enabled: libraryBooks.enabled,
      format: libraryBooks.format,
    })
    .from(libraryBooks)
    .where(and(eq(libraryBooks.id, id.data), isNull(libraryBooks.deletedAt)))
  if (!book || (!book.enabled && actor.role !== "ADMIN"))
    return failure("NOT_FOUND", "书籍不存在或已下架", 404)
  let cover = book.coverBytes
  let mime = book.coverMime
  if (
    !cover &&
    !book.coverUpdatedAt &&
    ["EPUB", "DOCX"].includes(book.format)
  ) {
    const [source] = await db
      .select({ bytes: libraryBooks.bytes, filename: libraryBooks.filename })
      .from(libraryBooks)
      .where(eq(libraryBooks.id, id.data))
    const imported = await importEbook(source.bytes, source.filename).catch(
      () => null,
    )
    // Fill covers for earlier imports once. An explicitly removed cover is never restored.
    const [updated] = await db
      .update(libraryBooks)
      .set({
        coverBytes: imported?.coverBytes ?? null,
        coverMime: imported?.coverMime ?? null,
        coverUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(libraryBooks.id, id.data),
          isNull(libraryBooks.coverUpdatedAt),
          isNull(libraryBooks.deletedAt),
        ),
      )
      .returning({
        coverBytes: libraryBooks.coverBytes,
        coverMime: libraryBooks.coverMime,
      })
    cover = updated?.coverBytes ?? null
    mime = updated?.coverMime ?? null
  }
  if (!cover || !mime) return failure("NOT_FOUND", "尚未设置封面", 404)
  return new Response(new Uint8Array(cover), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(cover.length),
      "Cache-Control": "private, no-store",
      Vary: "Authorization, Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
