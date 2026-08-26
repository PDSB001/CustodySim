import type { ReactNode } from "react"

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="page-header page-enter">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="page-header__eyebrow">
            <span className="dot" />
            <span>{eyebrow}</span>
          </div>
        ) : null}
        <h1 className="page-header__title">{title}</h1>
        {description ? (
          <p className="page-header__desc">{description}</p>
        ) : null}
      </div>
      {action ? <div className="page-header__actions">{action}</div> : null}
    </div>
  )
}