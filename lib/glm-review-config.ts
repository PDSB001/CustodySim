const providers = {
  bigmodel: {
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    apiKeyVariable: "GLM_API_KEY",
    defaultModel: "glm-4.1v-thinking-flash",
  },
  zai: {
    endpoint: "https://api.z.ai/api/paas/v4/chat/completions",
    apiKeyVariable: "ZAI_API_KEY",
    defaultModel: "glm-4.5-flash",
  },
} as const

export type GlmReviewModel =
  "glm-4.1v-thinking-flash" | "glm-4.5-flash" | "glm-4.7-flash"

export type GlmReviewConfig = {
  provider: string
  model: GlmReviewModel
  endpoint: string | null
  apiKeyVariable: string
  apiKey: string
  configurationError: string | null
}

/** Server-only configuration. Credentials never fall back across providers. */
export function getGlmReviewConfig(
  env: Record<string, string | undefined> = process.env,
  providerOverride?: string,
): GlmReviewConfig {
  const provider =
    providerOverride?.trim() || env.GLM_PROVIDER?.trim() || "bigmodel"
  const fallback = Object.hasOwn(providers, provider)
    ? providers[provider as keyof typeof providers].defaultModel
    : "glm-4.1v-thinking-flash"
  const model: GlmReviewModel = fallback
  const selected = Object.hasOwn(providers, provider)
    ? providers[provider as keyof typeof providers]
    : undefined
  const configurationError = selected
    ? null
    : "GLM_PROVIDER 仅支持 zai 或 bigmodel"
  const apiKeyVariable = selected?.apiKeyVariable ?? "ZAI_API_KEY"
  return {
    provider,
    model,
    endpoint: selected?.endpoint ?? null,
    apiKeyVariable,
    apiKey: configurationError ? "" : (env[apiKeyVariable]?.trim() ?? ""),
    configurationError,
  }
}
