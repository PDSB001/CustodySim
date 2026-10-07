"use client"

import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { z } from "zod"
import { MakeupReview } from "@/components/checkin/checkin-workspaces"
import { requestApi } from "@/components/shared/api-client"
import { SectionTabs } from "@/components/shared/section-tabs"
import { ReviewHistory } from "@/components/tasks/review-history"
import { SupervisorTasks } from "@/components/tasks/task-workspaces"

const Counts = z.object({
  pendingTasks: z.number(),
  pendingMakeups: z.number(),
})

export function ReviewWorkspace() {
  const tab = useSearchParams().get("tab") ?? "queue"
  const counts = useQuery({
    queryKey: ["review-counts"],
    queryFn: () => requestApi("/api/dashboard-summary", Counts),
  })
  return (
    <SectionTabs
      key={tab}
      initialTab={tab}
      label="任务与补卡审核分区"
      tabs={[
        {
          id: "queue",
          label: `待审任务${counts.data ? ` (${counts.data.pendingTasks})` : ""}`,
          content: <SupervisorTasks />,
        },
        {
          id: "makeups",
          label: `待审补卡${counts.data ? ` (${counts.data.pendingMakeups})` : ""}`,
          content: <MakeupReview />,
        },
        {
          id: "history",
          label: "批阅记录",
          content: (
            <SectionTabs
              label="审核记录类型"
              tabs={[
                { id: "tasks", label: "任务记录", content: <ReviewHistory /> },
                {
                  id: "makeups",
                  label: "补卡记录",
                  content: <MakeupReview historyOnly />,
                },
              ]}
            />
          ),
        },
      ]}
    />
  )
}
