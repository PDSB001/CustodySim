import { redirect } from "next/navigation"

export default function SupervisionMakeupsPage() {
  redirect("/supervision/tasks?tab=makeups")
}
