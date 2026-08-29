import Link from "next/link"
import { connection } from "next/server"

import { Button } from "@/components/ui/button"

export default async function NotFound() {
  await connection()

  return (
    <main className="bg-background text-foreground grid min-h-svh place-items-center px-6">
      <section className="max-w-md text-center">
        <p className="text-brand-600 text-sm font-semibold tracking-[0.2em]">
          404
        </p>
        <h1 className="font-display mt-3 text-3xl font-bold tracking-tight">
          页面不存在
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          你访问的页面不存在、已被移动，或当前链接已经失效。
        </p>
        <Button asChild className="mt-6">
          <Link href="/">返回首页</Link>
        </Button>
      </section>
    </main>
  )
}
