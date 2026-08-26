"use client"

import {
  Building2,
  CalendarCheck2,
  ClipboardList,
  FileCheck2,
  FileClock,
  Hash,
  LayoutDashboard,
  LogIn,
  Menu,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  TimerReset,
  UserRound,
  UsersRound,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { AccountMenu } from "@/components/layout/account-menu"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import type { SessionUser } from "@/lib/session"

const navSections = [
  {
    label: "概览",
    entries: [{ href: "/", label: "工作台", icon: LayoutDashboard }],
  },
  {
    label: "基础资料",
    entries: [
      { href: "/orgs", label: "组织架构", icon: Building2 },
      { href: "/accounts", label: "账户管理", icon: UsersRound },
      { href: "/persons", label: "人员档案", icon: UserRound },
      { href: "/prisoner-number", label: "人员编号", icon: Hash },
      { href: "/configs", label: "编号生成规则", icon: Settings2 },
      { href: "/profile-forms", label: "档案表单", icon: FileClock },
      { href: "/profile-records", label: "档案查看", icon: ClipboardList },
    ],
  },
  {
    label: "规则与审计",
    entries: [
      { href: "/relations", label: "监管关系", icon: UsersRound },
      { href: "/rule-groups", label: "规则组", icon: ClipboardList },
      { href: "/rules", label: "任务规则", icon: Settings2 },
      { href: "/report-templates", label: "任务表单", icon: FileClock },
      { href: "/checkin-rules", label: "打卡规则", icon: CalendarCheck2 },
      { href: "/audit-logs", label: "操作审计", icon: FileClock },
      { href: "/login-logs", label: "登录日志", icon: LogIn },
    ],
  },
  {
    label: "监管执行",
    entries: [
      { href: "/supervision/tasks", label: "执行任务", icon: ClipboardList },
      {
        href: "/supervision/checkins",
        label: "日常打卡",
        icon: CalendarCheck2,
      },
      { href: "/supervision/makeups", label: "补卡审核", icon: TimerReset },
      { href: "/profile-reviews", label: "档案审核", icon: FileCheck2 },
    ],
  },
  {
    label: "界面",
    entries: [
      { href: "/ui-config", label: "标语与文案", icon: MessageSquareText },
    ],
  },
] as const

function pathIsActive(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`)
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="app-sidebar">
      <div className="app-brand">
        <span className="app-brand__logo">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="app-brand__name truncate">CustodySim</p>
          <p className="app-brand__sub">管理控制台</p>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pb-3">
        {navSections.map((section) => (
          <div key={section.label} className="app-nav-group">
            <p className="app-nav-group__title">{section.label}</p>
            {section.entries.map(({ href, label, icon: Icon }) => {
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
        ))}
      </nav>

      <div className="border-t border-white/10 pt-3 text-[11px] text-white/50">
        <div className="flex items-center gap-2 px-2">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
          </span>
          服务运行正常
        </div>
      </div>
    </div>
  )
}

function currentPageTitle(pathname: string) {
  for (const section of navSections) {
    for (const entry of section.entries) {
      if (pathIsActive(pathname, entry.href)) return entry.label
    }
  }
  return "管理控制台"
}

export function DashboardShell({
  user,
  children,
}: Readonly<{ user: SessionUser; children: React.ReactNode }>) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const logout = async () => {
    setMobileNavOpen(false)
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.replace("/login")
  }
  const title = currentPageTitle(pathname)

  return (
    <div className="app-shell">
      <aside className="hidden lg:block">
        <SidebarContent />
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
                <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <p className="app-topbar__crumbs truncate">
                <span className="text-muted-foreground font-medium">
                  系统管理
                </span>
                <span className="app-topbar__crumb-sep">/</span>
                <span className="text-foreground truncate font-medium">
                  {title}
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <AccountMenu user={user} roleLabel="系统管理员" onLogout={logout} />
          </div>
        </header>
        <main className="app-main">{children}</main>
      </div>
    </div>
  )
}
