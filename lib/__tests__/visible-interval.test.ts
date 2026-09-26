import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeVisibleInterval } from "../visible-interval"

describe("visible UI clock", () => {
  let page: EventTarget & { visibilityState: string }

  beforeEach(() => {
    vi.useFakeTimers()
    page = Object.assign(new EventTarget(), { visibilityState: "visible" })
    vi.stubGlobal("document", page)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("pauses while hidden, refreshes on return, and fully cleans up", () => {
    const update = vi.fn()
    const unsubscribe = subscribeVisibleInterval(update, 1_000)
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2_000)
    expect(update).toHaveBeenCalledTimes(3)
    page.visibilityState = "hidden"
    page.dispatchEvent(new Event("visibilitychange"))
    vi.advanceTimersByTime(60_000)
    expect(update).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    page.visibilityState = "visible"
    page.dispatchEvent(new Event("visibilitychange"))
    expect(update).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(1)
    unsubscribe()
    page.dispatchEvent(new Event("visibilitychange"))
    vi.advanceTimersByTime(2_000)
    expect(update).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not start a clock when mounted in a hidden tab", () => {
    page.visibilityState = "hidden"
    const update = vi.fn()
    const unsubscribe = subscribeVisibleInterval(update, 1_000)
    vi.advanceTimersByTime(10_000)
    expect(update).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    unsubscribe()
  })
})
