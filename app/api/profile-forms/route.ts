import { asc, eq } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { profileFields, profileForms } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看可填写档案", 403)
  try {
    const [forms, fields] = await Promise.all([
      db
        .select()
        .from(profileForms)
        .where(eq(profileForms.active, true))
        .orderBy(asc(profileForms.createdAt)),
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
