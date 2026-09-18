import { z } from "zod"

/**
 * /api/dashboard-summary 的共享响应契约。
 * 所有消费 ["dashboard-summary"] 的组件必须解析同一形状，避免缓存被
 * 不同 schema 剥离字段后互相污染。
 */
export const DashboardSummarySchema = z.object({
  pendingTasks: z.number(),
  pendingMakeups: z.number(),
  pendingCheckins: z.number(),
  myPendingTasks: z.number(),
  inCustodyPersons: z.number(),
  enabledRules: z.number(),
  custodyStatus: z.string(),
  unreadNotices: z.number(),
})

export type DashboardSummary = z.infer<typeof DashboardSummarySchema>
