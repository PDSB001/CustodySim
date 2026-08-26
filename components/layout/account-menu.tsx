"use client"

import { ChevronDown, LogOut } from "lucide-react"

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
          className="h-9 gap-1.5 rounded-lg border border-border/70 bg-card px-1.5 pr-2 text-foreground transition-colors hover:border-border hover:bg-muted"
        >
          <Avatar className="size-6.5">
            <AvatarFallback className="bg-brand-500 text-[11px] font-semibold text-white">
              {user.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden truncate text-sm font-medium sm:max-w-30">
            {user.name}
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-lg p-1">
        <DropdownMenuLabel className="px-2 py-1.5">
          <span className="block text-sm font-medium text-foreground">
            {user.name}
          </span>
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
            <span className="size-1 rounded-full bg-brand-500" />
            {roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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