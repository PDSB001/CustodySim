import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { officialSeals } from "@/lib/db/schema"
import {
  defaultOfficialSealText,
  type OfficialSealKind,
} from "@/lib/official-seal"
import { generateOfficialSealData } from "@/lib/official-seal-image"

export async function getOfficialSealData(kind: OfficialSealKind) {
  const [seal] = await db
    .select()
    .from(officialSeals)
    .where(and(eq(officialSeals.kind, kind), eq(officialSeals.active, true)))
    .limit(1)
  return generateOfficialSealData({
    kind,
    organizationName: seal?.organizationName ?? "第一监狱",
    sealText: seal?.sealText ?? defaultOfficialSealText(kind),
  })
}
