"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === "dark"
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="切换主题"
      className="size-9 rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="size-4 hidden dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  )
}