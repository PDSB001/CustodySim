"use client"

import { NumberingManage } from "@/components/configs/numbering-manage"
import { PrisonerNumberManage } from "@/components/persons/prisoner-number-manage"
import { SectionTabs } from "@/components/shared/section-tabs"

/**
 * 人员编号工作台：把「人员编号」与「编号生成规则」合并到一页。
 * 两者操作的是同一套编号规则（/api/admin/numbering）与编号数据，原先分成两个页面。
 */
export function NumberingWorkspace({
  initialTab = "numbers",
}: {
  initialTab?: "numbers" | "rules"
}) {
  return (
    <SectionTabs
      initialTab={initialTab}
      label="人员编号分区"
      tabs={[
        { id: "numbers", label: "人员编号", content: <PrisonerNumberManage /> },
        {
          id: "rules",
          label: "编号生成规则",
          content: <NumberingManage />,
        },
      ]}
    />
  )
}
