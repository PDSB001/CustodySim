import { z } from "zod"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { libraryBooks } from "@/lib/db/schema"
import { BOOK_MAX_BYTES } from "@/lib/library"
import { importEbook } from "@/lib/ebook-import"
import { COVER_MAX_BYTES, prepareBookCover } from "@/lib/book-cover"

export async function POST(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可上传电子书", 403)
  if (
    Number(request.headers.get("content-length")) >
    BOOK_MAX_BYTES + COVER_MAX_BYTES + 65536
  )
    return failure("VALIDATION_ERROR", "电子书和封面文件过大", 413)
  try {
    const data = await request.formData()
    const metadata = z
      .object({
        title: z.string().trim().min(1).max(200),
        author: z.string().trim().max(200),
      })
      .safeParse({ title: data.get("title"), author: data.get("author") ?? "" })
    const file = data.get("file")
    if (!metadata.success || !(file instanceof File))
      return failure("VALIDATION_ERROR", "请填写书名并选择文件", 400)
    if (file.size > BOOK_MAX_BYTES)
      return failure("VALIDATION_ERROR", "文件不能超过 20 MB", 413)
    const bytes = Buffer.from(await file.arrayBuffer())
    let imported: Awaited<ReturnType<typeof importEbook>>
    try {
      imported = await importEbook(bytes, file.name)
      const cover = data.get("cover")
      if (cover instanceof File && cover.size > 0) {
        if (cover.size > COVER_MAX_BYTES) throw new Error("封面不能超过 3 MB")
        Object.assign(
          imported,
          await prepareBookCover(Buffer.from(await cover.arrayBuffer())),
        )
      }
    } catch (error) {
      return failure("VALIDATION_ERROR", (error as Error).message, 400)
    }
    const [book] = await db
      .insert(libraryBooks)
      .values({
        ...metadata.data,
        ...imported,
        coverUpdatedAt: imported.coverBytes ? new Date() : null,
        bytes,
        filename: file.name.slice(0, 255),
      })
      .returning({ id: libraryBooks.id })
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "上传电子书",
      entityType: "library_book",
      entityId: book.id,
      detail: { ...metadata.data, format: imported.format },
    })
    return success(book, { status: 201 })
  } catch (error) {
    console.error("[library upload]", error)
    return failure("INTERNAL_ERROR", "上传失败，请稍后重试", 500)
  }
}
