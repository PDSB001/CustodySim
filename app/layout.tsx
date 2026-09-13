import type { Metadata } from "next"
import { headers } from "next/headers"

import { AppProviders } from "@/components/providers"

import "./globals.css"

export const metadata: Metadata = {
  title: "CustodySim 监管任务模拟系统",
  description: "模拟监禁中的监室日程、点名报到、任务呈报与在押档案",
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined

  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-full font-sans antialiased">
        <AppProviders nonce={nonce}>{children}</AppProviders>
      </body>
    </html>
  )
}
