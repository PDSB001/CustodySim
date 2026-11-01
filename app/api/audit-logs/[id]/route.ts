import { eq } from "drizzle-orm"
import { z } from "zod"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { auditLogs } from "@/lib/db/schema"
import { redactAuditDetail } from "@/lib/audit-query"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看审计详情", 403)
  const { id } = await params
  if (!z.uuid().safeParse(id).success)
    return failure("VALIDATION_ERROR", "日志 ID 不合法", 400)
  try {
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .limit(1)
    if (!row) return failure("NOT_FOUND", "记录不存在或已超过保留期", 404)
    return success({ ...row, detail: redactAuditDetail(row.detail) })
  } catch {
    return failure("INTERNAL_ERROR", "暂时无法读取审计详情", 500)
  }
}
