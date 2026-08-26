import { z } from "zod"

import { success } from "@/lib/api-response"
import { clearAuthCookie } from "@/lib/auth-cookie"

const LogoutResponseSchema = z.object({ loggedOut: z.literal(true) })

export async function POST() {
  const response = success(LogoutResponseSchema.parse({ loggedOut: true }))
  clearAuthCookie(response)
  return response
}
