/**
 * 操作者身份类型：真人用户与系统级 AI 审核。
 * 审计、审核、积分等记录据此区分操作来源，避免 AI 动作被记到监管者账号名下。
 */
export const ACTOR_TYPES = ["USER", "SYSTEM_AI"] as const

export type ActorType = (typeof ACTOR_TYPES)[number]

/** 审计/业务记录可用的操作者身份，id 为空代表不存在对应的真实用户账号。 */
export type AuditActor = {
  id: string | null
  name: string
  role: string
  type?: ActorType
}

/** 系统级 AI 审核身份，不代表任何真人账号。 */
export const SYSTEM_AI_ACTOR: AuditActor = {
  id: null,
  name: "AI 自动审核",
  role: "SYSTEM_AI",
  type: "SYSTEM_AI",
}

export function getActorType(actor: AuditActor): ActorType {
  return actor.type ?? "USER"
}
