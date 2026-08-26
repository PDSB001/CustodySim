import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { ProfileFormSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { profileFields, profileForms } from "@/lib/db/schema"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看档案表单", 403)
  try {
    const [forms, fields] = await Promise.all([
      db.select().from(profileForms).orderBy(asc(profileForms.createdAt)),
      db.select().from(profileFields).orderBy(asc(profileFields.sort)),
    ])
    return success(
      forms.map((form) => ({
        ...form,
        fields: fields.filter((field) => field.formId === form.id),
      })),
    )
  } catch (error) {
    console.error("[API profile-forms GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理档案表单", 403)
  const parsed = ProfileFormSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const result = await db.transaction(async (tx) => {
      const [form] = await tx
        .insert(profileForms)
        .values({
          name: parsed.data.name,
          targetType: parsed.data.targetType,
          content: parsed.data.content ?? null,
          active: parsed.data.active,
        })
        .returning()
      if (!form) throw new Error("创建档案表单失败")
      const fields = await tx
        .insert(profileFields)
        .values(
          parsed.data.fields.map((field, sort) => ({
            ...field,
            formId: form.id,
            sort,
          })),
        )
        .returning()
      return { ...form, fields }
    })
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建档案表单",
      entityType: "profile_form",
      entityId: result.id,
      detail: { name: result.name },
    })
    return success(result, { status: 201 })
  } catch (error) {
    console.error("[API profile-forms POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
