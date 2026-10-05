import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { failure } from "@/lib/api-response"
import { readEpubResource } from "@/lib/reader-document"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  const path = new URL(request.url).searchParams.get("path")
  if (!parsed.success || !path || path.length > 1000)
    return failure("VALIDATION_ERROR", "参数不合法", 400)
  const [book] = await db
    .select({
      bytes: libraryBooks.bytes,
      format: libraryBooks.format,
      enabled: libraryBooks.enabled,
      deletedAt: libraryBooks.deletedAt,
    })
    .from(libraryBooks)
    .where(eq(libraryBooks.id, parsed.data))
  if (
    !book ||
    book.deletedAt ||
    (!book.enabled && actor.role !== "ADMIN") ||
    book.format !== "EPUB"
  )
    return failure("NOT_FOUND", "资源不存在", 404)
  try {
    const resource = readEpubResource(book.bytes, path)
    if (!resource) return failure("NOT_FOUND", "资源不存在", 404)
    return new Response(new Uint8Array(resource.bytes), {
      headers: {
        "Content-Type": resource.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    })
  } catch {
    return failure("VALIDATION_ERROR", "无法读取文档插图", 400)
  }
}
