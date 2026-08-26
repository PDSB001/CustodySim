"use client"

import { useQuery } from "@tanstack/react-query"
import {
  BellRing,
  CalendarCheck2,
  ClipboardCheck,
  FileText,
  Menu,
  ShieldCheck,
  TimerReset,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { z } from "zod"

import { AccountMenu } from "@/components/layout/account-menu"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { MarqueeBanner } from "@/components/shared/marquee-banner"
import { requestApi } from "@/components/shared/api-client"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import type { SessionUser } from "@/lib/session"

type WorkspaceKind = "SUPERVISOR" | "SUPERVISED"

const UiConfigSchema = z.object({
  scope: z.string(),
  homeTitle: z.string(),
  homeSubtitle: z.string(),
  homeBanner: z.string(),
})

const workspaceConfig = {
  SUPERVISOR: {
    title: "监管工作台",
    eyebrow: "执行中心",
    roleLabel: "监管者",
    entries: [
      { href: "/supervisor", label: "工作台", icon: ClipboardCheck },
      { href: "/supervisor/tasks", label: "执行任务", icon: ClipboardCheck },
      { href: "/supervisor/checkins", label: "日常打卡", icon: CalendarCheck2 },
      { href: "/supervisor/makeups", label: "补卡审核", icon: TimerReset },
      { href: "/supervisor/reports", label: "执行汇报", icon: FileText },
      {
        href: "/supervisor/profile-reviews",
        label: "档案会签",
        icon: FileText,
      },
      { href: "/supervisor/alerts", label: "风险提示", icon: BellRing },
    ],
  },
  SUPERVISED: {
    title: "个人服务台",
    eyebrow: "个人服务",
    roleLabel: "被监管者",
    entries: [
      { href: "/my", label: "我的首页", icon: UserRound },
      { href: "/my/tasks", label: "我的任务", icon: ClipboardCheck },
      { href: "/my/checkins", label: "打卡记录", icon: CalendarCheck2 },
      { href: "/my/notices", label: "通知公告", icon: BellRing },
      { href: "/my/profile", label: "个人档案", icon: FileText },
    ],
  },
} as const

function pathIsActive(pathname: string, href: string) {
  if (href === "/my" || href === "/supervisor") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function WorkspaceSidebar({
  kind,
  onNavigate,
}: {
  kind: WorkspaceKind
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const config = workspaceConfig[kind]

  return (
    <div className="app-sidebar">
      <div className="app-brand">
        <span className="app-brand__logo">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="app-brand__name truncate">CustodySim</p>
          <p className="app-brand__sub">{config.title}</p>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pb-3">
        <div className="app-nav-group">
          <p className="app-nav-group__title">{config.eyebrow}</p>
          {config.entries.map(({ href, label, icon: Icon }) => {
            const active = pathIsActive(pathname, href)
            return (
              <Link
                key={href}
                className={`app-nav-item ${active ? "is-active" : ""}`}
                href={href}
                onClick={onNavigate}
              >
                <Icon className="app-nav-item__icon" />
                <span>{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 pt-3 text-[11px] text-white/50">
        <div className="flex items-center gap-2 px-2">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
          </span>
          当前身份 · {config.roleLabel}
        </div>
      </div>
    </div>
  )
}

export function RoleShell({
  user,
  children,
}: Readonly<{ user: SessionUser; children: React.ReactNode }>) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const kind: WorkspaceKind =
    user.role === "SUPERVISED" ? "SUPERVISED" : "SUPERVISOR"
  const config = workspaceConfig[kind]
  const pageTitle =
    config.entries.find((entry) => pathIsActive(pathname, entry.href))?.label ??
    config.title
  const logout = async () => {
    setMobileNavOpen(false)
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.replace("/login")
  }

  const uiConfig = useQuery({
    queryKey: ["ui-config", kind],
    queryFn: () => requestApi(`/api/ui-config?scope=${kind}`, UiConfigSchema),
    staleTime: 60_000,
  })
  const banner = (uiConfig.data?.homeBanner ?? "")
    .replaceAll("{name}", user.name)
    .trim()

  return (
    <div className="app-shell">
      <aside className="hidden lg:block">
        <WorkspaceSidebar kind={kind} />
      </aside>
      <div className="min-w-0">
        <header className="app-topbar">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button
                  aria-label="打开导航"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 lg:hidden"
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[82vw] max-w-[18rem] gap-0 overflow-y-auto border-r-0 p-0"
                showCloseButton
              >
                <WorkspaceSidebar
                  kind={kind}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <p className="app-topbar__crumbs truncate">
                <span className="text-muted-foreground font-medium">
                  {config.eyebrow}
                </span>
                <span className="app-topbar__crumb-sep">/</span>
                <span className="text-foreground truncate font-medium">
                  {pageTitle}
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <AccountMenu
              user={user}
              roleLabel={config.roleLabel}
              onLogout={logout}
            />
          </div>
        </header>
        {banner ? <MarqueeBanner text={banner} /> : null}
        <main className="app-main">{children}</main>
      </div>
    </div>
  )
}
