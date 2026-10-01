"use client"

import { ChevronDown } from "lucide-react"
import { useId, useState, type Dispatch, type SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  communityFieldHasValue,
  communityProfileSection,
} from "@/lib/community-profile-fields"

export function ProfileCommunitySharing({
  fields,
  data,
  sharing,
  selected,
  saving,
  onSharingChange,
  onSelectionChange,
}: {
  fields: { name: string; type: string }[]
  data: Record<string, unknown>
  sharing: boolean
  selected: string[]
  saving: boolean
  onSharingChange: (value: boolean) => void
  onSelectionChange: Dispatch<SetStateAction<string[]>>
}) {
  const id = useId()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const groups = new Map<string, typeof fields>()
  for (const field of fields) {
    const title = communityProfileSection(field.name)
    groups.set(title, [...(groups.get(title) ?? []), field])
  }
  const chosenGroups = [...groups]
    .map(([title, entries]) => ({
      title,
      fields: entries.filter((field) => selected.includes(field.name)),
    }))
    .filter((group) => group.fields.length > 0)

  return (
    <section
      className="bg-muted/40 space-y-4 rounded-xl border p-4"
      aria-label="自愿分享档案"
    >
      <div className="flex items-center gap-3">
        <Checkbox
          id={`${id}-sharing`}
          checked={sharing}
          disabled={saving}
          onCheckedChange={(checked) => onSharingChange(checked === true)}
        />
        <label
          htmlFor={`${id}-sharing`}
          className="cursor-pointer text-sm font-medium"
        >
          分享所选档案至匿名社区
        </label>
      </div>
      <p className="text-muted-foreground text-xs leading-5">
        默认关闭，仅公开勾选并预览的内容。身份字段勾选后也会公开；照片、签名与公章不分享。
      </p>
      {sharing ? (
        <>
          <div className="space-y-2">
            {[...groups].map(([title, entries], groupIndex) => {
              const available = entries
                .filter((field) => communityFieldHasValue(data[field.name]))
                .map((field) => field.name)
              const chosen = available.filter((name) =>
                selected.includes(name),
              ).length
              const open = expanded[title] ?? false
              const groupId = `${id}-group-${groupIndex}`
              return (
                <div
                  key={title}
                  className="bg-background overflow-hidden rounded-lg border"
                >
                  <div className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={
                        chosen > 0 && chosen === available.length
                          ? true
                          : chosen > 0
                            ? "indeterminate"
                            : false
                      }
                      aria-label={`分享${title}中已填写的内容`}
                      disabled={saving || !available.length}
                      onCheckedChange={(checked) =>
                        onSelectionChange((current) =>
                          checked === true
                            ? [...new Set([...current, ...available])]
                            : current.filter(
                                (name) =>
                                  !entries.some((field) => field.name === name),
                              ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 min-w-0 flex-1 justify-between gap-3 px-2 py-1.5 text-left whitespace-normal"
                      aria-expanded={open}
                      aria-controls={groupId}
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          [title]: !open,
                        }))
                      }
                    >
                      <span className="min-w-0">
                        <span className="text-foreground block text-sm font-medium">
                          {title}
                        </span>
                        <span className="text-muted-foreground block text-xs font-normal">
                          {available.length
                            ? `已选 ${chosen} 项 · ${available.length} 项已填写`
                            : "尚未填写"}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </div>
                  <div id={groupId} hidden={!open} className="border-t p-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {entries.map((field, fieldIndex) => {
                        const fieldId = `${groupId}-field-${fieldIndex}`
                        const filled = communityFieldHasValue(data[field.name])
                        return (
                          <div
                            key={field.name}
                            className="flex items-start gap-2"
                          >
                            <Checkbox
                              id={fieldId}
                              className="mt-0.5"
                              checked={selected.includes(field.name)}
                              disabled={saving || !filled}
                              onCheckedChange={(checked) =>
                                onSelectionChange((current) =>
                                  checked === true
                                    ? [...new Set([...current, field.name])]
                                    : current.filter(
                                        (name) => name !== field.name,
                                      ),
                                )
                              }
                            />
                            <label
                              htmlFor={fieldId}
                              className={`min-w-0 cursor-pointer text-sm ${filled ? "" : "text-muted-foreground"}`}
                            >
                              <span className="block">{field.name}</span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {filled
                                  ? String(data[field.name]).replaceAll(
                                      "\n",
                                      " ",
                                    )
                                  : "尚未填写"}
                              </span>
                            </label>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="bg-background space-y-3 rounded-lg border p-4 text-sm">
            <p className="font-medium">社区公开预览 · 楼主</p>
            {chosenGroups.length ? (
              chosenGroups.map((group) => (
                <div key={group.title} className="space-y-1">
                  <p className="text-sm font-medium">{group.title}</p>
                  <p className="text-muted-foreground text-sm leading-6 wrap-anywhere">
                    {group.fields
                      .map(
                        (field) =>
                          `${field.name}：${String(data[field.name] ?? "")}`,
                      )
                      .join(" · ")}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                选择已填写的内容后，这里会显示公开预览。
              </p>
            )}
            <p className="text-muted-foreground text-xs leading-5">
              提交会签时发布，可在社区删除自己的分享帖。
            </p>
          </div>
        </>
      ) : null}
    </section>
  )
}
