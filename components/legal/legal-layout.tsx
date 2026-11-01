import Link from "next/link"
import type { ReactNode } from "react"
import { LEGAL_EFFECTIVE_DATE } from "@/lib/legal-version"

export function LegalLayout({
  title,
  version,
  children,
}: {
  title: string
  version: string
  children: ReactNode
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-10 text-sm leading-7">
      <Link href="/login" className="underline">
        返回登录
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p>
        版本：{version}
        <br />
        更新日期及生效日期：{LEGAL_EFFECTIVE_DATE}
      </p>
      <div className="space-y-5 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold">
        {children}
      </div>
    </main>
  )
}
