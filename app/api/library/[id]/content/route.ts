import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { failure } from "@/lib/api-response"

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
      text: libraryBooks.readerText,
      format: libraryBooks.format,
      enabled: libraryBooks.enabled,
      deletedAt: libraryBooks.deletedAt,
    })
    .from(libraryBooks)
    .where(eq(libraryBooks.id, id.data))
  if (!book || book.deletedAt || (!book.enabled && actor.role !== "ADMIN"))
    return failure("NOT_FOUND", "书籍不存在或已下架", 404)
  let text = book.text
  if (text === null && book.format === "TXT") {
    const [source] = await db
      .select({ bytes: libraryBooks.bytes })
      .from(libraryBooks)
      .where(eq(libraryBooks.id, id.data))
    text = source.bytes.toString("utf8")
  }
  if (text === null)
    return failure("VALIDATION_ERROR", "该书籍没有可阅读的正文", 400)
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  })
}
