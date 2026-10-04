import { eq } from "drizzle-orm"
import { z } from "zod"
import { failure } from "@/lib/api-response"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

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
    .select({ bytes: libraryBooks.bytes, format: libraryBooks.format, enabled: libraryBooks.enabled, deletedAt: libraryBooks.deletedAt })
    .from(libraryBooks)
    .where(eq(libraryBooks.id, id.data))
    .limit(1)
  if (!book || book.deletedAt || (!book.enabled && actor.role !== "ADMIN"))
    return failure("NOT_FOUND", "书籍不存在或已下架", 404)
  return new Response(new Uint8Array(book.bytes), {
    headers: {
      "Content-Type":
        (
          {
            PDF: "application/pdf",
            TXT: "text/plain; charset=utf-8",
            EPUB: "application/epub+zip",
            DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          } as Record<string, string>
        )[book.format] ?? "application/octet-stream",
      "Content-Length": String(book.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
