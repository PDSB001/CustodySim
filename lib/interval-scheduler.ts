/**
 * 长周期定时任务的安全调度器。
 *
 * 背景（真实踩过的坑）：`setInterval` 的延迟按 **32 位有符号整数**存储，
 * 超过 2147483647ms（≈ 24.8 天）会溢出并被截断为 1ms，同时抛出
 * `TimeoutOverflowWarning`。也就是说，把"90 天""2 年"这类保留期直接传给
 * setInterval，会让清理任务退化成**每毫秒执行一次的数据库循环**。
 *
 * 因此这里统一为：定时器按 tickMs（默认 1 小时）唤醒，是否真正执行由
 * elapsed 判断。周期再长也不会溢出。
 */

const DEFAULT_TICK_MS = 60 * 60 * 1000

export function startIntervalScheduler({
  key,
  intervalMs,
  tickMs = DEFAULT_TICK_MS,
  label,
  run,
}: {
  /** 全局去重用的 symbol，避免多实例/热更新时重复起定时器 */
  key: symbol
  /** 真正的执行间隔，可以任意长（例如 90 天、2 年） */
  intervalMs: number
  /** 定时器唤醒节拍，必须远小于 32 位上限 */
  tickMs?: number
  /** 日志前缀 */
  label: string
  run: () => Promise<unknown>
}) {
  const runtime = globalThis as typeof globalThis &
    Record<symbol, ReturnType<typeof setInterval> | undefined>
  if (runtime[key]) return

  let lastRunAt = Date.now()
  // 进程启动先补跑一次：部署/重启本身就是"周期已到"的信号，
  // 也能避免长期不重启时清理任务永远不执行。
  void run().catch((error: unknown) =>
    console.error(`[${label}] initial run failed`, error),
  )

  const timer = setInterval(() => {
    if (Date.now() - lastRunAt < intervalMs) return
    lastRunAt = Date.now()
    void run().catch((error: unknown) =>
      console.error(`[${label}] scheduled run failed`, error),
    )
  }, tickMs)
  timer.unref?.()
  runtime[key] = timer
}
