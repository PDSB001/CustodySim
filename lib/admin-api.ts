import { getSessionUser } from "@/lib/session"

export async function getAdminUser() {
  const user = await getSessionUser()
  return user?.role === "ADMIN" ? user : null
}

export function getRequestIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip")
  )
}
