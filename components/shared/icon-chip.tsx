import type { LucideIcon } from "lucide-react"
import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger"

export function IconChip({
  icon: Icon,
  size = "md",
  tone = "neutral",
  className,
}: {
  icon: LucideIcon
  size?: "sm" | "md"
  tone?: Tone
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        size === "sm" ? "size-7" : "size-9",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "brand" && "bg-brand-500/10 text-brand-700",
        tone === "info" && "bg-info/10 text-info",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "danger" && "bg-overdue/10 text-overdue",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  )
}