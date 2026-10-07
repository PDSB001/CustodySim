import { afterEach, expect, it, vi } from "vitest"
import {
  prepareAutoReview,
  validateAutoDecision,
} from "@/lib/auto-review-policy"
import { reviewWithGlm } from "@/lib/glm-review"
import { getGlmReviewConfig } from "@/lib/glm-review-config"

const template = {
  content: "说明今天完成的一项工作及结果",
  fields: [{ name: "说明", type: "TEXTAREA", required: true, options: [] }],
}
const data = { 说明: "今天整理了书架，按类别放好并清理了灰尘。" }
const approved = {
  result: "APPROVED",
  confidence: 0.95,
  reason: "回答具体，符合要求",
  issues: [],
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it("只发送模板定义的答案字段", () => {
  expect(
    prepareAutoReview(template, { ...data, secret: "不发送" }, false).input
      ?.answers,
  ).toEqual(data)
})

it("明确的现场核验和签字要求在调用模型前交人工", () => {
  expect(
    prepareAutoReview(
      { ...template, content: "必须核实现场设备已经维修完成，并由负责人签字" },
      data,
      false,
    ).decision?.result,
  ).toBe("MANUAL")
  expect(
    prepareAutoReview(
      { ...template, content: "描述整理步骤，仅审核文字，不需要核验线下事实" },
      data,
      false,
    ).input,
  ).toBeDefined()
})
it("必填空白不能自动通过", () => {
  expect(
    prepareAutoReview(template, { 说明: "  " }, false).decision?.result,
  ).toBe("RETURNED")
})
it("禁闭、图片和没有明确要求的模板交人工", () => {
  expect(prepareAutoReview(template, data, true).decision?.result).toBe(
    "MANUAL",
  )
  expect(
    prepareAutoReview(
      { ...template, fields: [{ ...template.fields[0], type: "IMAGE" }] },
      data,
      false,
    ).decision?.result,
  ).toBe("MANUAL")
  expect(
    prepareAutoReview({ ...template, content: "" }, data, false).decision
      ?.result,
  ).toBe("MANUAL")
})
it("不确定或矛盾的模型结论交人工", () => {
  expect(
    validateAutoDecision({ ...approved, confidence: 0.7 }, data).result,
  ).toBe("MANUAL")
  expect(
    validateAutoDecision(
      {
        ...approved,
        issues: [{ field: "说明", quote: "今天", problem: "不满足要求" }],
      },
      data,
    ).result,
  ).toBe("MANUAL")
})
it("退回必须引用实际回答的证据", () => {
  const returned = {
    ...approved,
    result: "RETURNED",
    issues: [{ field: "说明", quote: "伪造内容", problem: "缺少结果" }],
  }
  expect(validateAutoDecision(returned, data).result).toBe("MANUAL")
  expect(
    validateAutoDecision(
      {
        ...returned,
        issues: [{ field: "说明", quote: "今天", problem: "缺少结果" }],
      },
      data,
    ).result,
  ).toBe("RETURNED")
})
it.each([429, 500])("GLM HTTP %s 不自动通过或退回", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("error", { status })),
  )
  expect(
    (await reviewWithGlm({ requirements: template, answers: data }, "test-key"))
      .result,
  ).toBe("MANUAL")
})
it("调用超时保留人工审核", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
  expect(
    (await reviewWithGlm({ requirements: template, answers: data }, "test-key"))
      .result,
  ).toBe("MANUAL")
})
it("严格解析模型输出并限制模型为免费 Flash", async () => {
  vi.stubEnv("GLM_PROVIDER", "zai")
  vi.stubEnv("GLM_REVIEW_MODEL", "glm-4.7-flash")
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(approved) },
        },
      ],
    }),
  )
  vi.stubGlobal("fetch", fetcher)
  expect(
    (await reviewWithGlm({ requirements: template, answers: data }, "test-key"))
      .result,
  ).toBe("APPROVED")
  const call = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.z.ai/api/paas/v4/chat/completions",
  )
  expect(call.model).toBe("glm-4.7-flash")
  expect(call.thinking).toEqual({ type: "enabled" })
  expect(call.response_format).toEqual({ type: "json_object" })
  expect(call.messages[1].role).toBe("user")
})
it("服务商之间不回退使用另一站点的密钥", () => {
  expect(
    getGlmReviewConfig({ GLM_API_KEY: "domestic-secret" }, "zai").apiKey,
  ).toBe("")
  expect(
    getGlmReviewConfig(
      {
        ZAI_API_KEY: "overseas-secret",
        GLM_API_KEY: "domestic-secret",
      },
      "zai",
    ).apiKey,
  ).toBe("overseas-secret")
  const domestic = getGlmReviewConfig({
    GLM_PROVIDER: "bigmodel",
    GLM_REVIEW_MODEL: "glm-4.1v-thinking-flash",
    GLM_API_KEY: "domestic-secret",
    ZAI_API_KEY: "overseas-secret",
  })
  expect(domestic.apiKey).toBe("domestic-secret")
  expect(domestic.endpoint).toBe(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  )
})
it.each([
  { GLM_PROVIDER: "constructor" },
  { GLM_PROVIDER: "https://other.example" },
])("不支持的服务商不会发起请求: %j", async (env) => {
  const fetcher = vi.fn()
  vi.stubGlobal("fetch", fetcher)
  const config = getGlmReviewConfig(env)
  expect(
    (
      await reviewWithGlm(
        { requirements: template, answers: data },
        "test-key",
        config,
      )
    ).result,
  ).toBe("MANUAL")
  expect(fetcher).not.toHaveBeenCalled()
})
it("截断或非 JSON 响应不应用", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: { content: JSON.stringify(approved) },
          },
        ],
      }),
    ),
  )
  expect(
    (await reviewWithGlm({ requirements: template, answers: data }, "test-key"))
      .result,
  ).toBe("MANUAL")
})
