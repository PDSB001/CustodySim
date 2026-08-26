import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type IconTone = "brand" | "info" | "success" | "warning" | "danger"

export function MetricCell({
  label,
  value,
  detail,
  icon: Icon,
  tone = "brand",
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon: LucideIcon
  tone?: IconTone
}) {
  return (
    <div className="metric-cell">
      <div className="metric-cell__head">
        <span className="metric-cell__label">{label}</span>
        <span className={cn("metric-cell__icon", `metric-cell__icon--${tone}`)}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="metric-cell__value">{value}</div>
      {detail ? <div className="metric-cell__row">{detail}</div> : null}
    </div>
  )
}