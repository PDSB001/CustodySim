import { createHmac } from "node:crypto"
import { isCommunityProfileField } from "@/lib/community-contract"

export function communityAuthorLabel(
  postId: string,
  authorId: string,
  postAuthorId: string,
  secret: string,
) {
  if (authorId === postAuthorId) return "楼主"
  return (
    "匿名 " +
    createHmac("sha256", secret)
      .update(`community:${postId}:${authorId}`)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase()
  )
}

export function buildCommunityProfileSnapshot(
  fields: { name: string; type: string }[],
  data: Record<string, unknown>,
  selected: string[],
) {
  const allowed = new Set(
    fields.filter(isCommunityProfileField).map((field) => field.name),
  )
  if (selected.some((name) => !allowed.has(name)))
    throw new Error("所选档案字段不可公开")
  return [...new Set(selected)].map((name) => {
    const value = data[name]
    if (typeof value !== "string" && typeof value !== "number")
      throw new Error("请选择已填写的档案字段")
    const text = String(value).trim()
    if (!text || text.length > 500)
      throw new Error("分享字段不能为空或超过 500 字")
    return { name, value: text }
  })
}
