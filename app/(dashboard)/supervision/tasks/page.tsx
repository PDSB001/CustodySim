import { SectionTabs } from "@/components/shared/section-tabs"
import { ReviewHistory } from "@/components/tasks/review-history"
import { SupervisorTasks } from "@/components/tasks/task-workspaces"

export default function SupervisionTasksPage() {
  return (
    <SectionTabs
      label="任务批阅分区"
      tabs={[
        { id: "queue", label: "待审队列", content: <SupervisorTasks /> },
        { id: "history", label: "批阅记录", content: <ReviewHistory /> },
      ]}
    />
  )
}
