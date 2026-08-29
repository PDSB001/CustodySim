import { redirect } from "next/navigation"

import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { getSessionUser } from "@/lib/session"

export default async function MyChatPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  return <ChatWorkspace user={user} />
}
