import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  alignActionWithTitle = false,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  /**
   * 状态标签/操作对齐到标题行。
   * 开启后右侧内容不再贴在页面最上方（观感上像"漂浮在右上角"），
   * 而是与标题基线形成明确关系；窄屏不生效，避免多占一行高度。
   */
  alignActionWithTitle?: boolean
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
      {action ? (
        <div
          className={cn(
            "page-header__actions",
            alignActionWithTitle && "page-header__actions--with-title",
          )}
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
