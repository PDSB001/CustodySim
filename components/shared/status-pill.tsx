import type { ReactNode } from "react"

export type StatusTone =
  | "neutral"
  | "brand"
  | "info"
  | "success"
  | "warning"
  | "pending"
  | "danger"

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`status-pill status-pill--${tone} ${className ?? ""}`.trim()}>
      {children}
    </span>
  )
}