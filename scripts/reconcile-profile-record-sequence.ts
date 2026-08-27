import { eq } from "drizzle-orm"

import { db } from "../lib/db"
import { numberingRules, profileRecords } from "../lib/db/schema"
import { getHighestSequentialCodeNumber } from "../lib/numbering"

const PROFILE_RECORD_DOC_TYPE = "PROFILE_RECORD"

async function main() {
  const [rule] = await db
    .select()
    .from(numberingRules)
    .where(eq(numberingRules.docType, PROFILE_RECORD_DOC_TYPE))
    .limit(1)
  if (!rule || rule.generationMode !== "SEQUENTIAL") {
    console.log("档案编号未使用连续流水，无需回算。")
    return
  }
  const records = await db.select({ code: profileRecords.code }).from(profileRecords)
  const currentSeq = getHighestSequentialCodeNumber({
    codes: records.flatMap((record) => (record.code ? [record.code] : [])),
    prefix: rule.prefix,
    dateFormat: rule.dateFormat,
    minLength: rule.minLength,
  })
  await db
    .update(numberingRules)
    .set({ currentSeq, updatedAt: new Date() })
    .where(eq(numberingRules.id, rule.id))
  console.log(`已回算档案编号流水：${currentSeq}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
