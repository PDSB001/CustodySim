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
    <div className="flex flex-col items-center justify-center px-6 py-8 text-center sm:py-10">
      <div className="empty-illustration" aria-hidden>
        <div className="empty-illustration__blob" />
        <div className="empty-illustration__core">
          <Icon className="size-9" strokeWidth={1.5} />
        </div>
      </div>
      <p className="font-display text-foreground text-lg font-semibold tracking-tight">
        {title}
      </p>
      {description ? (
        <p className="text-muted-foreground mt-2 max-w-sm text-[13px] leading-6">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
