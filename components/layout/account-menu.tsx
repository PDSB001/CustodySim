"use client"

import { ChevronDown, KeyRound, LogOut } from "lucide-react"
import Link from "next/link"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SessionUser } from "@/lib/session"

export function AccountMenu({
  user,
  roleLabel,
  onLogout,
}: {
  user: SessionUser
  roleLabel: string
  onLogout: () => Promise<void>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="打开账号菜单"
          variant="ghost"
          className="border-border/70 bg-card text-foreground hover:border-border hover:bg-muted h-9 gap-1.5 rounded-lg border px-1.5 pr-2 transition-colors"
        >
          <Avatar className="size-6.5">
            <AvatarFallback className="bg-brand-500 text-[11px] font-semibold text-white">
              {user.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden truncate text-sm font-medium sm:max-w-30">
            {user.name}
          </span>
          <ChevronDown className="text-muted-foreground hidden size-3.5 sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-lg p-1">
        <DropdownMenuLabel className="px-2 py-1.5">
          <span className="text-foreground block text-sm font-medium">
            {user.name}
          </span>
          <span className="bg-brand-500/10 text-brand-700 mt-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium">
            <span className="bg-brand-500 size-1 rounded-full" />
            {roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound />
            修改密码
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => void onLogout()}
        >
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
