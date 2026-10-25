"use client"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { z } from "zod"
import { requestApi, formatDate } from "@/components/shared/api-client"
const State = z
  .object({
    state: z.string(),
    trialStart: z.string(),
    trialEnd: z.string(),
    score: z.number(),
    evaluatedAt: z.string().nullable(),
  })
  .nullable()
export function ProbationBanner() {
  const result = useQuery({
    queryKey: ["account-probation"],
    queryFn: () => requestApi("/api/account/probation", State),
    refetchInterval: 60_000,
  })
  if (result.isError)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        首周考察信息暂不可用，请刷新页面。
      </p>
    )
  const data = result.data
  if (!data) return null
  return (
    <aside
      className="bg-primary/5 space-y-2 rounded-xl border p-4"
      aria-label="首周考察"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>
          {data.state === "PASSED" ? "首周考察已通过" : "首周账号考察"}
        </strong>
        <span>已结算积分：{data.score}</span>
      </div>
      <p className="text-muted-foreground text-sm leading-6">
        {formatDate(data.trialStart)} 至 {formatDate(data.trialEnd)}
        。考察期积分须严格大于 0；截止后预留 10 分钟完成结算，未达标自动停用。
      </p>
      <Link href="/my/scores" className="text-sm underline underline-offset-4">
        查看积分与规则
      </Link>
    </aside>
  )
}
