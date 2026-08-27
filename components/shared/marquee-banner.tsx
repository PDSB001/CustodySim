"use client"

import { Megaphone } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

const SPEED_PX_PER_SECOND = 36

export function MarqueeBanner({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [shouldScroll, setShouldScroll] = useState(false)
  const [duration, setDuration] = useState(0)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)

    updatePreference()
    mediaQuery.addEventListener("change", updatePreference)
    return () => mediaQuery.removeEventListener("change", updatePreference)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const measure = () => {
      const containerWidth = container.clientWidth
      const contentWidth = content.scrollWidth
      const needScroll = contentWidth > containerWidth
      setShouldScroll(needScroll)
      if (needScroll) {
        setDuration(contentWidth / SPEED_PX_PER_SECOND)
      }
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(container)
    resizeObserver.observe(content)
    return () => resizeObserver.disconnect()
  }, [text])

  if (!text.trim()) return null

  return (
    <div
      ref={containerRef}
      className={cn(
        "group border-border/60 bg-brand-500/[0.05] text-foreground relative flex items-center gap-3 overflow-hidden border-b px-4 py-2.5 text-[15px] leading-6 font-medium sm:px-5",
        className,
      )}
    >
      <span className="bg-brand-500/15 text-brand-700 grid size-6 shrink-0 place-items-center rounded">
        <Megaphone className="size-3.5" />
      </span>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        {shouldScroll && !prefersReducedMotion ? (
          <div
            className="flex w-max whitespace-nowrap group-hover:[animation-play-state:paused]"
            style={{
              animation: `marquee ${duration}s linear infinite`,
            }}
          >
            <div ref={contentRef} className="inline-block pr-16">
              {text}
            </div>
            <div className="inline-block pr-16" aria-hidden>
              {text}
            </div>
          </div>
        ) : (
          <div
            ref={contentRef}
            className={prefersReducedMotion ? "text-pretty" : "truncate"}
          >
            {text}
          </div>
        )}
      </div>
    </div>
  )
}
