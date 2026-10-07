import { redirect } from "next/navigation"

export default function SupervisorMakeupsPage() {
  redirect("/supervisor/tasks?tab=makeups")
}
