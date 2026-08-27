import { AlertTriangle, RefreshCcw } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function ErrorState({
  title = "加载失败",
  description = "数据获取失败，请稍后重试。",
  onRetry,
  compact = false,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  /** 紧凑模式：用于嵌入到其他卡片内部时缩小内边距 */
  compact?: boolean
}) {
  return (
    <div
      className={`surface-panel motion-item flex flex-col items-center gap-2 text-center ${
        compact ? "px-4 py-6" : "px-6 py-10"
      }`}
    >
      <span
        className={`bg-destructive/10 text-destructive grid place-items-center rounded-full ${
          compact ? "size-8" : "size-10"
        }`}
      >
        <AlertTriangle className={compact ? "size-4" : "size-5"} />
      </span>
      <div className="space-y-0.5">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-xs leading-5">
          {description}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCcw />
          重新加载
        </Button>
      ) : null}
    </div>
  )
}

export function LoadingBlock({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="加载中"
      className={`bg-muted/40 animate-pulse rounded-xl ${className ?? "min-h-[120px]"}`}
    />
  )
}

/**
 * 统一处理 loading / error / empty 三态。优先级：loading > error > empty > children。
 * 用法：
 *   <QueryStateView
 *     isLoading={query.isLoading}
 *     error={query.error}
 *     onRetry={query.refetch}
 *     isEmpty={!query.data?.length}
 *     loading={<LoadingBlock />}
 *     errorFallback={<ErrorState ... />}
 *     empty={<EmptyState ... />}
 *   >{...children...}</QueryStateView>
 */
export function QueryStateView({
  isLoading,
  error,
  isEmpty,
  onRetry,
  loading,
  errorFallback,
  empty,
  children,
}: {
  isLoading: boolean
  error: unknown
  isEmpty?: boolean
  onRetry?: () => void
  loading?: ReactNode
  errorFallback?: ReactNode
  empty?: ReactNode
  children: ReactNode
}) {
  if (isLoading && loading) return <>{loading}</>
  if (error) {
    return <>{errorFallback ?? <ErrorState onRetry={onRetry} />}</>
  }
  if (isEmpty && empty) return <>{empty}</>
  return <>{children}</>
}