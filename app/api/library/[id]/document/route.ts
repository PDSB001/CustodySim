import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { failure, success } from "@/lib/api-response"
import {
  cachedReaderDocument,
  ReaderSourceChangedError,
} from "@/lib/reader-document-cache"
import { readerKey } from "@/lib/reader-identity"

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
    readerKey: readerKey(actor.id, parsed.data),
  }
  const responseHeaders = {
    "Cache-Control": "private, no-store",
    "X-CustodySim-Book-Revision": book.revision,
  }
  if (new URL(request.url).searchParams.get("metadata") === "1")
    return success(
      { format: book.format, readerSchema: 3, ...identity },
      { headers: responseHeaders },
    )
  if (book.format === "PDF")
    return success(
      { version: 1, format: "PDF", ...identity },
      { headers: responseHeaders },
    )
  try {
    const document = await cachedReaderDocument(
      parsed.data,
      book.revision,
      book.format,
      async () => {
        const [source] = await db
          .select({ bytes: libraryBooks.bytes })
          .from(libraryBooks)
          .where(
            and(
              eq(libraryBooks.id, parsed.data),
              eq(libraryBooks.contentRevision, book.revision),
              isNull(libraryBooks.deletedAt),
              actor.role === "ADMIN"
                ? undefined
                : eq(libraryBooks.enabled, true),
            ),
          )
          .limit(1)
        if (!source) throw new ReaderSourceChangedError()
        return source.bytes
      },
    )
    return success({ ...document, ...identity }, { headers: responseHeaders })
  } catch (error) {
    if (error instanceof ReaderSourceChangedError)
      return failure("NOT_FOUND", "书籍已变更，请重新打开", 404)
    return failure(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "无法解析阅读文档",
      400,
    )
  }
}
