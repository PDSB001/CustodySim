"use client"

import { PersonManage } from "@/components/persons/person-manage"
import { ProfileFormManage } from "@/components/profile-forms/profile-form-manage"
import { ProfileRecordManage } from "@/components/profile-records/profile-record-manage"
import { SectionTabs } from "@/components/shared/section-tabs"

/**
 * 在押档案工作台：人员台账、档案表单定义、档案填写记录原先分属三页，
 * 但它们描述的是同一个「档案」对象，合并到一页按分区查看。
 */
export function ArchiveWorkspace({
  initialTab = "persons",
}: {
  initialTab?: "persons" | "forms" | "records"
}) {
  return (
    <SectionTabs
      initialTab={initialTab}
      label="在押档案分区"
      tabs={[
        { id: "persons", label: "人员台账", content: <PersonManage /> },
        { id: "forms", label: "档案表单", content: <ProfileFormManage /> },
        { id: "records", label: "档案记录", content: <ProfileRecordManage /> },
      ]}
    />
  )
}
