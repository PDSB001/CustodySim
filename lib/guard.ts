import type { Role } from "@/lib/constants"
import type { SessionUser } from "@/lib/session"

export class ForbiddenError extends Error {
  constructor() {
    super("无权限执行此操作")
  }
}
export function requireRole(user: SessionUser, ...roles: Role[]) {
  if (!roles.includes(user.role)) throw new ForbiddenError()
  return user
}
