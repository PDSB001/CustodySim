import type { Role } from "@/lib/constants"

export function getRoleHome(role: Role) {
  switch (role) {
    case "ADMIN":
      return "/"
    case "SUPERVISOR":
      return "/supervisor"
    case "SUPERVISED":
      return "/my"
  }
}
