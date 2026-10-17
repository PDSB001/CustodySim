"use client"

import RouteError, {
  type RouteErrorProps,
} from "@/components/shared/route-error"

export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="zh-CN">
      <body>
        <RouteError {...props} />
      </body>
    </html>
  )
}
