import { z } from "zod"
import { MakeupReviewTraceSchema } from "@/lib/makeup-review-contract"
import { dateText } from "./checkin-card"

type MakeupReviewTrace = z.infer<typeof MakeupReviewTraceSchema> & {
  status: string
  reviewComment?: string | null
  reviewedAt?: string | null
}

function autoResultText(status: string, result: string | null) {
  if (status === "PROCESSING") return "自动审核进行中"
  if (status === "MANUAL" || result === "MANUAL") return "自动审核转人工"
  if (result === "APPROVED") return "自动审核通过"
  if (result === "RETURNED") return "自动审核退回"
  return "自动审核记录"
}

export function MakeupReviewTrace({ makeup }: { makeup: MakeupReviewTrace }) {
  const currentRun = makeup.autoReviewHistory.find((run) => run.isCurrent)
  const finalReview = makeup.reviewHistory.find((review) => review.isCurrent)
  const events = [
    ...makeup.autoReviewHistory.map((run) => ({
      id: run.id,
      title: autoResultText(run.status, run.result),
      detail:
        run.reason ??
        (run.status === "PROCESSING" ? "正在等待审核结果" : "未记录审核原因"),
      metadata: `配置模型：${run.model}`,
      createdAt: run.createdAt,
      isCurrent: run.isCurrent,
    })),
    ...makeup.reviewHistory.map((review) => ({
      id: review.id,
      title: `${review.actorType === "SYSTEM_AI" ? "AI 应用审核结果" : "人工审核"} · ${review.result === "APPROVED" ? "通过" : "驳回"}`,
      detail: review.comment?.trim() || "未填写审核意见",
      metadata: `审核人：${review.actorName}`,
      createdAt: review.createdAt,
      isCurrent: review.isCurrent,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <>
      {makeup.status === "PENDING" && makeup.autoReviewReason && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          自动审核转人工：{makeup.autoReviewReason}
        </p>
      )}
      {makeup.status === "PENDING" && currentRun?.status === "PROCESSING" && (
        <p role="status" className="text-muted-foreground text-sm">
          自动审核进行中，人工审核仍可处理此申请。
        </p>
      )}
      {makeup.status !== "PENDING" && (
        <div className="bg-muted/60 space-y-1 rounded-lg p-3 text-sm">
          <p>最终审核：{makeup.status === "APPROVED" ? "已通过" : "已拒绝"}</p>
          <p className="text-muted-foreground">
            {finalReview ? `审核人：${finalReview.actorName}` : "审核人未记录"}
            {makeup.reviewedAt && ` · ${dateText(makeup.reviewedAt)}`}
          </p>
          <p>审核意见：{makeup.reviewComment?.trim() || "未填写审核意见"}</p>
        </div>
      )}
      {events.length ? (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            审核轨迹（{events.length} 条）
          </summary>
          <ol aria-label="补卡审核轨迹" className="mt-3 space-y-3">
            {events.map((event) => (
              <li key={event.id} className="border-l-2 pl-3">
                <p className="font-medium">
                  {event.title}
                  {!event.isCurrent && " · 历史申请"}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {event.metadata} · {dateText(event.createdAt)}
                </p>
                <p className="mt-1 leading-6 whitespace-pre-wrap">
                  {event.detail}
                </p>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <p className="text-muted-foreground text-xs">
          暂无自动审核或审核操作记录
        </p>
      )}
    </>
  )
}
