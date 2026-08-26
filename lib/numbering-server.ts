import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { numberingRules } from "@/lib/db/schema"
import { buildCode, buildRandomCode } from "@/lib/numbering"

const PROFILE_RECORD_DOC_TYPE = "PROFILE_RECORD"

/** Generates a final archival number using an independent rule from personnel IDs. */
export async function generateProfileRecordCode() {
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .select()
      .from(numberingRules)
      .where(eq(numberingRules.docType, PROFILE_RECORD_DOC_TYPE))
      .limit(1)
    const activeRule =
      rule ??
      (
        await tx
          .insert(numberingRules)
          .values({
            docType: PROFILE_RECORD_DOC_TYPE,
            prefix: "ARC",
            dateFormat: "yyyyMM",
            generationMode: "SEQUENTIAL",
            minLength: 4,
            randomLength: 6,
          })
          .returning()
      )[0]
    if (!activeRule) throw new Error("无法初始化档案编号规则")

    if (activeRule.generationMode === "RANDOM")
      return buildRandomCode({
        prefix: activeRule.prefix,
        dateFormat: activeRule.dateFormat,
        randomLength: activeRule.randomLength,
      })

    const nextSequence = activeRule.currentSeq + 1
    await tx
      .update(numberingRules)
      .set({ currentSeq: nextSequence, updatedAt: new Date() })
      .where(eq(numberingRules.id, activeRule.id))
    return buildCode({
      prefix: activeRule.prefix,
      dateFormat: activeRule.dateFormat,
      sequence: nextSequence,
      minLength: activeRule.minLength,
    })
  })
}
