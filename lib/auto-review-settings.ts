import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { autoReviewSettings } from "@/lib/db/schema"

export const AutoReviewSettingsSchema = z
  .object({
    enabled: z.boolean(),
    makeupEnabled: z.boolean(),
    provider: z.enum(["bigmodel", "zai"]),
    actorId: z.string().uuid().nullable(),
    templateIds: z
      .array(z.string().uuid())
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, "模板不能重复"),
    revision: z.string().uuid().nullable(),
  })
  .strict()

export function isMissingAutoReviewStorage(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as { code?: string; cause?: unknown }
  return (
    ["42P01", "42703"].includes(value.code ?? "") ||
    (value.cause !== error && isMissingAutoReviewStorage(value.cause))
  )
}

export async function getAutoReviewSettings() {
  const defaults = {
    enabled: false,
    makeupEnabled: false,
    provider: "bigmodel" as const,
    actorId: null,
    templateIds: [] as string[],
    revision: null,
  }
  try {
    const [row] = await db
      .select()
      .from(autoReviewSettings)
      .where(eq(autoReviewSettings.id, "default"))
    return {
      settings: row
        ? {
            enabled: row.enabled,
            makeupEnabled: row.makeupEnabled,
            provider:
              row.provider === "zai" ? ("zai" as const) : ("bigmodel" as const),
            actorId: row.actorId,
            templateIds: row.templateIds,
            revision: row.revision,
          }
        : defaults,
      storageReady: true,
    }
  } catch (error) {
    if (isMissingAutoReviewStorage(error))
      return { settings: defaults, storageReady: false }
    throw error
  }
}
