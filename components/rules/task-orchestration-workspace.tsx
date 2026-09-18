"use client"

import { AutoReviewManage } from "@/components/configs/auto-review-manage"
import { ReportTemplateManage } from "@/components/report-templates/report-template-manage"
import { RuleGroupManage } from "@/components/rules/rule-group-manage"
import { RuleManage } from "@/components/rules/rule-manage"
import { SectionTabs } from "@/components/shared/section-tabs"

/**
 * 任务编排工作台：任务规则、规则组、任务表单与随机任务池、自动审核
 * 原先分属四个路由，且彼此互相引用（规则选规则组/表单，任务表单页内含任务池）。
 * 例外说明：自动审核作用于任务呈报，因此与任务规则同页。
 */
export function TaskOrchestrationWorkspace({
  initialTab = "rules",
}: {
  initialTab?: "rules" | "groups" | "templates" | "auto-review"
}) {
  return (
    <SectionTabs
      initialTab={initialTab}
      label="任务编排分区"
      tabs={[
        { id: "rules", label: "任务规则", content: <RuleManage /> },
        { id: "groups", label: "规则组", content: <RuleGroupManage /> },
        {
          id: "templates",
          label: "表单与任务池",
          content: <ReportTemplateManage />,
        },
        {
          id: "auto-review",
          label: "自动审核",
          content: <AutoReviewManage />,
        },
      ]}
    />
  )
}
