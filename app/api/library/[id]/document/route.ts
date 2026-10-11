import { createHash } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { failure, success } from "@/lib/api-response"
import { buildReaderDocument } from "@/lib/reader-document"

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
  if (!parsed.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const [book] = await db
    .select({
      revision: libraryBooks.contentRevision,
      format: libraryBooks.format,
      enabled: libraryBooks.enabled,
      deletedAt: libraryBooks.deletedAt,
    })
    .from(libraryBooks)
    .where(eq(libraryBooks.id, parsed.data))
  if (!book || book.deletedAt || (!book.enabled && actor.role !== "ADMIN"))
    return failure("NOT_FOUND", "书籍不存在或已下架", 404)
  const identity = {
    renderMetadataVersion: 1,
    revision: book.revision,
    readerKey: createHash("sha256")
      .update(`${actor.id}:${parsed.data}`)
      .digest("hex")
      .slice(0, 24),
  }
  if (new URL(request.url).searchParams.get("metadata") === "1")
    return success({ format: book.format, readerSchema: 3, ...identity })
  if (book.format === "PDF")
    return success({ version: 1, format: "PDF", ...identity })
  const [source] = await db
    .select({ bytes: libraryBooks.bytes })
    .from(libraryBooks)
    .where(
      and(
        eq(libraryBooks.id, parsed.data),
        eq(libraryBooks.contentRevision, book.revision),
        isNull(libraryBooks.deletedAt),
        actor.role === "ADMIN" ? undefined : eq(libraryBooks.enabled, true),
      ),
    )
    .limit(1)
  if (!source) return failure("NOT_FOUND", "书籍已变更，请重新打开", 404)
  try {
    const document = await buildReaderDocument(
      source.bytes,
      book.format,
      `/api/library/${parsed.data}/resource`,
    )
    return success({ ...document, ...identity })
  } catch (error) {
    return failure(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "无法解析阅读文档",
      400,
    )
  }
}
