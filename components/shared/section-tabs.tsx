"use client"

import { useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type SectionTab = {
  id: string
  label: string
  content: ReactNode
}

/**
 * 管理端的分区标签栏：把原先散落在多个路由里的同类功能收敛到一页。
 * 仅渲染当前分区，未激活的模块不会挂载，因此也不会触发多余的数据请求。
 */
export function SectionTabs({
  tabs,
  initialTab,
  label = "功能分区",
}: {
  tabs: SectionTab[]
  initialTab?: string
  label?: string
}) {
  const [active, setActive] = useState(() =>
    tabs.some((tab) => tab.id === initialTab)
      ? (initialTab as string)
      : (tabs[0]?.id ?? ""),
  )
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]
  return (
    <div className="workspace-stack">
      <div
        role="tablist"
        aria-label={label}
        className="border-border/70 flex flex-wrap gap-1 border-b"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current?.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-brand-500 text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {current ? <div role="tabpanel">{current.content}</div> : null}
    </div>
  )
}
