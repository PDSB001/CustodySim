import { z } from "zod"
import { FIELD_TYPES, validateFieldPayload } from "@/lib/fields"

export const AutoReviewDecision = z
  .object({
    result: z.enum(["APPROVED", "RETURNED", "MANUAL"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(1200),
    issues: z
      .array(
        z
          .object({
            field: z.string().max(100),
            quote: z.string().min(1).max(300),
            problem: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(8),
  })
  .strict()
export type AutoDecision = z.infer<typeof AutoReviewDecision>
export const ReviewTemplate = z.object({
  name: z.string().max(160).optional(),
  content: z.string().max(8000).nullable().optional(),
  fields: z
    .array(
      z.object({
        name: z.string().max(100),
        type: z.enum(FIELD_TYPES),
        required: z.boolean(),
        options: z.array(z.string()),
      }),
    )
    .min(1)
    .max(30),
})
export const manualDecision = (reason: string): AutoDecision => ({
  result: "MANUAL",
  confidence: 0,
  reason,
  issues: [],
})

export function prepareAutoReview(
  template: unknown,
  data: unknown,
  restricted: boolean,
) {
  if (restricted) return { decision: manualDecision("该类任务需人工审核") }
  const parsed = ReviewTemplate.safeParse(template)
  if (
    !parsed.success ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  )
    return { decision: manualDecision("任务模板或提交格式无法自动判断") }
  // Explicit external-evidence requirements are outside text review. Do not
  // rely on a model to decide whether missing signatures warrant rejection.
  const requirements = (parsed.data.content ?? "").replace(
    /(?:无需|不需要|不必)(?:核实|核验|验证|确认)(?:现场|线下)事实/g,
    "",
  )
  if (
    /(?:必须|务必|应当)(?:核实|核验|验证|确认).{0,16}(?:现场|线下)|(?:核实|核验)(?:现场|线下)|(?:负责人|主管).{0,6}签字/.test(
      requirements,
    )
  )
    return {
      decision: manualDecision("任务要求现场核验或签字证明，请人工审核"),
    }
  const values = data as Record<string, unknown>
  if (parsed.data.fields.some((field) => field.type === "IMAGE"))
    return { decision: manualDecision("含图片的任务需人工核验") }
  const selected: Record<string, string | number> = {}
  for (const field of parsed.data.fields) {
    const value = values[field.name]
    if (
      value !== undefined &&
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number"
    )
      return { decision: manualDecision("字段包含无法自动判断的内容") }
    selected[field.name] =
      typeof value === "string" ? value.trim() : (value ?? "")
  }
  const check = validateFieldPayload(parsed.data.fields, selected)
  if (!check.valid)
    return {
      decision: {
        result: "RETURNED",
        confidence: 1,
        reason: Object.entries(check.errors)
          .map(([name, error]) => `${name}：${error}`)
          .join("；")
          .slice(0, 1200),
        issues: [],
      } as AutoDecision,
    }
  if (!parsed.data.content?.trim())
    return {
      decision: manualDecision("模板尚未填写明确的任务要求，请人工审核"),
    }
  const input = { requirements: parsed.data, answers: selected }
  if (JSON.stringify(input).length > 16000)
    return { decision: manualDecision("内容过长，需人工审核") }
  return { input }
}

export function validateAutoDecision(
  raw: unknown,
  answers: Record<string, string | number>,
): AutoDecision {
  const parsed = AutoReviewDecision.safeParse(raw)
  if (!parsed.success) return manualDecision("模型未返回有效的审核结论")
  const decision = parsed.data
  if (decision.result === "MANUAL") return decision
  if (decision.confidence < 0.9)
    return manualDecision("模型判断不确定，需人工复核")
  if (decision.result === "APPROVED" && decision.issues.length)
    return manualDecision("模型结论存在矛盾，需人工复核")
  if (
    decision.result === "RETURNED" &&
    (!decision.issues.length ||
      decision.issues.some(
        (issue) =>
          !Object.hasOwn(answers, issue.field) ||
          !String(answers[issue.field]).includes(issue.quote),
      ))
  )
    return manualDecision("模型未提供可核对的退回依据")
  return decision
}
