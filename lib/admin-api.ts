import { getSessionUser } from "@/lib/session"

export { getRequestIp } from "@/lib/request-ip"

export async function getAdminUser() {
  const user = await getSessionUser()
  return user?.role === "ADMIN" ? user : null
}
