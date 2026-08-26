import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="empty-illustration" aria-hidden>
        <div className="empty-illustration__blob" />
        <div className="empty-illustration__core">
          <Icon className="size-9" strokeWidth={1.5} />
        </div>
      </div>
      <p className="font-display text-lg font-semibold tracking-tight text-foreground">
        {title}
      </p>
      {description ? (
        <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}