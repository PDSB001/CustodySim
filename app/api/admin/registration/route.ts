import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  organizations,
  registrationEmailBlocks,
  registrations,
  registrationSettings,
  registrationRiskBlocks,
  users,
} from "@/lib/db/schema"
import {
  blockRegistrationEmail,
  getRegistrationSettings,
} from "@/lib/registration-server"
import {
  normalizeRegistrationEmail,
  registrationEmailHash,
} from "@/lib/registration-policy"
import { registrationCaptchaConfig } from "@/lib/registration-captcha"

export async function GET(request: Request) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理注册", 403)
  const input = z
    .object({
      page: z.coerce.number().int().min(0).max(10000),
      blocksPage: z.coerce.number().int().min(0).max(10000),
      riskPage: z.coerce.number().int().min(0).max(10000),
    })
    .safeParse({
      page: new URL(request.url).searchParams.get("page") ?? 0,
      blocksPage: new URL(request.url).searchParams.get("blocksPage") ?? 0,
      riskPage: new URL(request.url).searchParams.get("riskPage") ?? 0,
    })
  if (!input.success) return failure("VALIDATION_ERROR", "页码不合法", 400)
  const [settings, rooms, accounts, blocks, riskBlocks] = await Promise.all([
    getRegistrationSettings(),
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.category, "ROOM")),
    db
      .select({
        userId: registrations.userId,
        username: users.username,
        name: users.name,
        state: registrations.state,
        status: users.status,
        trialStart: registrations.trialStart,
        trialEnd: registrations.trialEnd,
        finalScore: registrations.finalScore,
      })
      .from(registrations)
      .innerJoin(users, eq(users.id, registrations.userId))
      .orderBy(desc(registrations.createdAt), registrations.userId)
      .offset(input.data.page * 20)
      .limit(21),
    db
      .select()
      .from(registrationEmailBlocks)
      .orderBy(
        desc(registrationEmailBlocks.createdAt),
        registrationEmailBlocks.emailHash,
      )
      .offset(input.data.blocksPage * 20)
      .limit(21),
    db
      .select()
      .from(registrationRiskBlocks)
      .orderBy(
        desc(registrationRiskBlocks.createdAt),
        registrationRiskBlocks.id,
      )
      .offset(input.data.riskPage * 20)
      .limit(21),
  ])
  return success({
    settings,
    rooms,
    accounts: accounts.slice(0, 20),
    hasMore: accounts.length > 20,
    blocks: blocks.slice(0, 20),
    blocksHasMore: blocks.length > 20,
    captchaReady: registrationCaptchaConfig().ready,
    riskBlocks: riskBlocks.slice(0, 20),
    riskHasMore: riskBlocks.length > 20,
  })
}
export async function PATCH(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理注册", 403)
  const input = z
    .object({
      enabled: z.boolean(),
      organizationId: z.string().uuid().nullable(),
    })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return failure("VALIDATION_ERROR", "注册设置不合法", 400)
  await getRegistrationSettings()
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('registration-mutations'))`,
    )
    if (input.data.organizationId) {
      const [room] = await tx
        .select()
        .from(organizations)
        .where(
          and(
            eq(organizations.id, input.data.organizationId),
            eq(organizations.category, "ROOM"),
          ),
        )
      if (!room)
        return failure("VALIDATION_ERROR", "注册账号必须归属到监室", 400)
    }
    await tx
      .update(registrationSettings)
      .set(input.data)
      .where(eq(registrationSettings.id, 1))
    await writeAuditLog(
      {
        actor,
        action: "UPDATE",
        actionLabel: "修改自由注册设置",
        entityType: "registration_settings",
        detail: input.data,
      },
      tx,
    )
    return success({ saved: true })
  })
}
export async function POST(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理注册", 403)
  const input = z
    .object({
      userId: z.string().uuid().optional(),
      email: z
        .string()
        .transform(normalizeRegistrationEmail)
        .pipe(z.email().max(254))
        .optional(),
      reason: z.string().trim().min(2).max(300),
    })
    .strict()
    .refine((value) => Boolean(value.userId) !== Boolean(value.email))
    .safeParse(await request.json().catch(() => null))
  if (!input.success)
    return failure(
      "VALIDATION_ERROR",
      "请提供注册账号或邮箱，以及拉黑原因",
      400,
    )
  let hash: string
  if (input.data.userId) {
    const [entry] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.userId, input.data.userId))
    if (!entry) return failure("NOT_FOUND", "该账号不是自主注册账号", 404)
    hash = entry.emailHash
  } else hash = registrationEmailHash(input.data.email!)
  await blockRegistrationEmail(hash, input.data.reason, new Date(), actor)
  return success({ saved: true })
}
export async function DELETE(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理注册", 403)
  const input = z
    .object({
      riskBlockId: z.string().uuid().optional(),
      emailHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      email: z
        .string()
        .transform(normalizeRegistrationEmail)
        .pipe(z.email().max(254))
        .optional(),
    })
    .strict()
    .refine(
      (value) =>
        [value.emailHash, value.email, value.riskBlockId].filter(Boolean)
          .length === 1,
    )
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return failure("VALIDATION_ERROR", "邮箱摘要无效", 400)
  const emailHash =
    input.data.emailHash ??
    (input.data.email ? registrationEmailHash(input.data.email) : null)
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('registration-mutations'))`,
    )
    if (input.data.riskBlockId)
      await tx
        .delete(registrationRiskBlocks)
        .where(eq(registrationRiskBlocks.id, input.data.riskBlockId))
    else if (emailHash)
      await tx
        .delete(registrationEmailBlocks)
        .where(eq(registrationEmailBlocks.emailHash, emailHash))
    await writeAuditLog(
      {
        actor,
        action: "DELETE",
        actionLabel: input.data.riskBlockId
          ? "解除注册浏览器或网络限制"
          : "解除注册邮箱黑名单",
        entityType: input.data.riskBlockId
          ? "registration_risk_blocks"
          : "registration_email_blocks",
        entityId: input.data.riskBlockId ?? null,
      },
      tx,
    )
  })
  return success({ removed: true })
}
