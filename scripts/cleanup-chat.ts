import { lt } from "drizzle-orm"

import { CHAT_AUDIT_RETENTION_DAYS } from "@/lib/chat"
import { db } from "@/lib/db"
import { chatMessages } from "@/lib/db/schema"

async function main() {
  const cutoff = new Date(
    Date.now() - CHAT_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
  const deleted = await db
    .delete(chatMessages)
    .where(lt(chatMessages.createdAt, cutoff))
    .returning({ id: chatMessages.id })
  console.log(
    `Deleted ${deleted.length} chat messages older than ${cutoff.toISOString()}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Chat cleanup failed", error)
    process.exit(1)
  })
