"use client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import styles from "./library.module.css"
const ScoreSettings = z.object({
  enabled: z.boolean(),
  minutesPerPoint: z.number(),
  dailyCap: z.number(),
})
export function ReadingScoreSettings() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["library-score-settings"],
    queryFn: () => requestApi("/api/admin/library/settings", ScoreSettings),
  })
  const [busy, setBusy] = useState(false)
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await requestApi("/api/admin/library/settings", ScoreSettings, {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.get("enabled") === "on",
          minutesPerPoint: Number(form.get("minutesPerPoint")),
          dailyCap: Number(form.get("dailyCap")),
        }),
      })
      await client.invalidateQueries({ queryKey: ["library-score-settings"] })
      await client.invalidateQueries({ queryKey: ["library"] })
      toast.success("阅读积分设置已保存")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.panel}>
      <h2 className="text-base font-semibold">阅读积分</h2>
      <p className={styles.caption}>有效阅读自动累计，两端共用每日额度。</p>
      {query.isPending && (
        <p role="status" className={styles.caption}>
          正在加载设置…
        </p>
      )}
      {query.isError && (
        <div role="alert">
          <p className="text-destructive text-sm">{query.error.message}</p>
          <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
            重试
          </Button>
        </div>
      )}
      {query.data && (
        <form
          key={JSON.stringify(query.data)}
          onSubmit={save}
          className="mt-5 space-y-4"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={query.data.enabled}
              className="accent-primary size-4"
            />
            启用阅读积分
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-sm">
              <span>每 1 分所需分钟</span>
              <Input
                name="minutesPerPoint"
                type="number"
                min={1}
                max={1440}
                required
                defaultValue={query.data.minutesPerPoint}
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>每日最高积分</span>
              <Input
                name="dailyCap"
                type="number"
                min={1}
                max={3}
                required
                defaultValue={query.data.dailyCap}
              />
            </label>
          </div>
          <p className={styles.caption}>
            按上海日期结算。学习任务通过后，另按任务积分规则记分。
          </p>
          <Button
            disabled={busy}
            type="submit"
            variant="outline"
            className="w-full"
          >
            {busy ? "正在保存…" : "保存积分设置"}
          </Button>
        </form>
      )}
    </section>
  )
}
