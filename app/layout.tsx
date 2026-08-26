import type { Metadata } from "next"

import { AppProviders } from "@/components/providers"

import "./globals.css"

export const metadata: Metadata = {
  title: "CustodySim 监管任务模拟系统",
  description: "监管任务、执行、审核与档案闭环管理平台",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-full font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
