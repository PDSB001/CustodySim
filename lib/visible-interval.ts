/** Pause UI clocks in hidden tabs and refresh immediately when returning. */
export function subscribeVisibleInterval(
  callback: () => void,
  intervalMs: number,
) {
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  const resume = () => {
    stop()
    if (document.visibilityState === "hidden") return
    callback()
    timer = setInterval(callback, intervalMs)
  }
  document.addEventListener("visibilitychange", resume)
  resume()
  return () => {
    stop()
    document.removeEventListener("visibilitychange", resume)
  }
}
