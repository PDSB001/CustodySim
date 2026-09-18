"use client"

import { ImageGallery } from "@/components/shared/image-upload-field"

export type SnapshotField = {
  name: string
  type: string
  options?: string[]
}

/**
 * 只读渲染一次呈报的表单内容（按任务生成时的模板快照逐字段展示）。
 *
 * 监管员批阅页与被监管人「查看任务内容」共用这一份渲染，
 * 避免两处各写一套导致展示口径漂移。
 */
export function TaskSubmissionContent({
  fields,
  data,
}: {
  fields: SnapshotField[]
  data: Record<string, unknown> | null | undefined
}) {
  if (!fields.length)
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        本项任务的填写内容尚未配置，请联系管理处核对。
      </p>
    )

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      {fields.map((field) => {
        const value = data?.[field.name]
        if (field.type === "COPYWRITE") {
          const source = (field.options?.[0] ?? "").trim()
          const written = String(value ?? "").trim()
          const exact = written === source
          return (
            <div key={field.name}>
              <p className="text-xs font-semibold text-slate-500">
                {field.name}
              </p>
              <p className="mt-1 text-xs text-slate-400">原文：{source}</p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">
                {written || "（未填写）"}
              </p>
              <p className="mt-1 text-xs">
                {written ? (
                  exact ? (
                    <span className="font-medium text-emerald-600">
                      ✓ 逐字一致
                    </span>
                  ) : (
                    <span className="font-medium text-amber-600">
                      ⚠ 抄写与原文不一致
                    </span>
                  )
                ) : (
                  <span className="text-slate-400">未填写</span>
                )}
              </p>
            </div>
          )
        }
        if (field.type === "IMAGE") {
          return (
            <div key={field.name}>
              <p className="text-xs font-semibold text-slate-500">
                {field.name}
              </p>
              <ImageGallery
                value={value}
                label={`${field.name}提交图片`}
                emptyText="（未上传）"
              />
            </div>
          )
        }
        return (
          <div key={field.name}>
            <p className="text-xs font-semibold text-slate-500">{field.name}</p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">
              {String(value ?? "") || "（未填写）"}
            </p>
          </div>
        )
      })}
    </div>
  )
}
