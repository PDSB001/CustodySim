"use client"

import { IsolationSettingsManage } from "@/components/scores/isolation-settings-manage"
import { ScoreboardManage } from "@/components/scores/scoreboard-manage"
import { SectionTabs } from "@/components/shared/section-tabs"

/**
 * 积分与禁闭工作台：周度积分榜与禁闭任务设置原先分属两个路由，
 * 但禁闭由积分周结触发，属同一套规则，合并到一页。
 */
export function DisciplineWorkspace({
  initialTab = "scores",
}: {
  initialTab?: "scores" | "isolation"
}) {
  return (
    <SectionTabs
      initialTab={initialTab}
      label="积分与禁闭分区"
      tabs={[
        {
          id: "scores",
          label: "积分与禁闭",
          content: <ScoreboardManage canAdjust />,
        },
        {
          id: "isolation",
          label: "禁闭任务设置",
          content: <IsolationSettingsManage />,
        },
      ]}
    />
  )
}
