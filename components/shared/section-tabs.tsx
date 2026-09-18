"use client"

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"

export type SectionTab = {
  id: string
  label: string
  content: ReactNode
}

/**
 * 管理端的分区标签栏：把原先散落在多个路由里的同类功能收敛到一页。
 * 仅渲染当前分区，未激活的模块不会挂载，因此也不会触发多余的数据请求。
 *
 * 键盘行为遵循 WAI-ARIA Tabs 模式：整个标签栏在 Tab 键序列中只占一个站点
 * （roving tabIndex），进入后用 ←/→ 切换、Home/End 跳首尾，
 * 并通过 aria-controls / aria-labelledby 把标签与面板关联起来。
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
  // useId 可能含冒号、书名号等字符，清掉后仍保持实例间唯一，同时可安全用于选择器。
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]

  function activateAt(index: number) {
    const next = tabs[index]
    if (!next) return
    setActive(next.id)
    tabRefs.current[index]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1
    if (event.key === "ArrowRight") {
      event.preventDefault()
      activateAt(index === last ? 0 : index + 1)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      activateAt(index === 0 ? last : index - 1)
    } else if (event.key === "Home") {
      event.preventDefault()
      activateAt(0)
    } else if (event.key === "End") {
      event.preventDefault()
      activateAt(last)
    }
  }

  return (
    <div className="workspace-stack">
      <div
        role="tablist"
        aria-label={label}
        className="border-border/70 flex flex-wrap gap-1 border-b"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === current?.id
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-controls={`${baseId}-panel-${tab.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => setActive(tab.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-brand-500 text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {current ? (
        <div
          key={current.id}
          role="tabpanel"
          id={`${baseId}-panel-${current.id}`}
          aria-labelledby={`${baseId}-tab-${current.id}`}
        >
          {current.content}
        </div>
      ) : null}
    </div>
  )
}
