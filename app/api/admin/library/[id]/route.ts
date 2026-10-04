import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { libraryBooks, readingProgress, readingSessions } from "@/lib/db/schema"
import { BOOK_MAX_BYTES } from "@/lib/library"
import { COVER_MAX_BYTES, prepareBookCover } from "@/lib/book-cover"
import { importEbook } from "@/lib/ebook-import"

const Metadata = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(200),
})
const Update = Metadata.partial()
  .extend({ enabled: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0)
type Context = { params: Promise<{ id: string }> }
const available = (id: string) =>
  and(eq(libraryBooks.id, id), isNull(libraryBooks.deletedAt))

export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理电子书", 403)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  const parsed = Update.safeParse(await request.json().catch(() => null))
  if (!id.success || !parsed.success)
    return failure("VALIDATION_ERROR", "请填写有效的书名和作者", 400)
  const [book] = await db
    .update(libraryBooks)
    .set(parsed.data)
    .where(available(id.data))
    .returning({ id: libraryBooks.id })
  if (!book) return failure("NOT_FOUND", "书籍不存在", 404)
  await writeAuditLog({
    actor,
    action: "UPDATE",
    actionLabel: "更新电子书",
    entityType: "library_book",
    entityId: book.id,
    detail: parsed.data,
  })
  return success(book)
}

export async function PUT(request: Request, context: Context) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理电子书", 403)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  if (
    Number(request.headers.get("content-length")) >
    BOOK_MAX_BYTES + COVER_MAX_BYTES + 65536
  )
    return failure("VALIDATION_ERROR", "电子书和封面文件过大", 413)
  let data: FormData
  try {
    data = await request.formData()
  } catch {
    return failure("VALIDATION_ERROR", "上传内容无效", 400)
  }
  const metadata = Metadata.safeParse({
    title: data.get("title"),
    author: data.get("author") ?? "",
  })
  if (!metadata.success)
    return failure("VALIDATION_ERROR", "请填写有效的书名和作者", 400)
  const changes: Partial<typeof libraryBooks.$inferInsert> = {
    ...metadata.data,
  }
  const file = data.get("file")
  const replaced = file instanceof File && file.size > 0
  try {
    if (replaced) {
      if (file.size > BOOK_MAX_BYTES) throw new Error("电子书不能超过 20 MB")
      const bytes = Buffer.from(await file.arrayBuffer())
      const imported = await importEbook(bytes, file.name)
      Object.assign(changes, {
        bytes,
        filename: file.name.slice(0, 255),
        format: imported.format,
        readerText: imported.readerText,
      })
      if (imported.coverBytes)
        Object.assign(changes, {
          coverBytes: imported.coverBytes,
          coverMime: imported.coverMime,
          coverUpdatedAt: new Date(),
        })
    }
    const cover = data.get("cover")
    if (cover instanceof File && cover.size > 0) {
      if (cover.size > COVER_MAX_BYTES) throw new Error("封面不能超过 3 MB")
      Object.assign(
        changes,
        await prepareBookCover(Buffer.from(await cover.arrayBuffer())),
        { coverUpdatedAt: new Date() },
      )
    } else if (data.get("removeCover") === "true") {
      Object.assign(changes, {
        coverBytes: null,
        coverMime: null,
        coverUpdatedAt: new Date(),
      })
    }
  } catch (error) {
    return failure("VALIDATION_ERROR", (error as Error).message, 400)
  }
  const book = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(libraryBooks)
      .set(changes)
      .where(available(id.data))
      .returning({ id: libraryBooks.id })
    if (!updated) return null
    if (replaced) {
      await tx
        .update(readingSessions)
        .set({ closed: true, active: false })
        .where(eq(readingSessions.bookId, id.data))
      await tx
        .update(readingProgress)
        .set({ page: 1, updatedAt: new Date() })
        .where(eq(readingProgress.bookId, id.data))
    }
    await writeAuditLog(
      {
        actor,
        action: "UPDATE",
        actionLabel: "编辑电子书",
        entityType: "library_book",
        entityId: updated.id,
        detail: {
          ...metadata.data,
          replacedFile: replaced,
          replacedCover: Boolean(changes.coverBytes),
          removedCover: data.get("removeCover") === "true",
        },
      },
      tx,
    )
    return updated
  })
  return book ? success(book) : failure("NOT_FOUND", "书籍不存在", 404)
}

export async function DELETE(_: Request, context: Context) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理电子书", 403)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const book = await db.transaction(async (tx) => {
    const [removed] = await tx
      .update(libraryBooks)
      .set({ enabled: false, deletedAt: new Date() })
      .where(available(id.data))
      .returning({ id: libraryBooks.id })
    if (!removed) return null
    await tx
      .update(readingSessions)
      .set({ closed: true, active: false })
      .where(eq(readingSessions.bookId, id.data))
    await writeAuditLog(
      {
        actor,
        action: "DELETE",
        actionLabel: "将电子书移出书架",
        entityType: "library_book",
        entityId: removed.id,
        detail: { retainedReadingHistory: true },
      },
      tx,
    )
    return removed
  })
  return book ? success(book) : failure("NOT_FOUND", "书籍不存在", 404)
}
