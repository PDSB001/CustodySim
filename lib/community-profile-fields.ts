import { isCommunityProfileField } from "@/lib/community-contract"

type Field = { name: string; type: string }

export function communityShareableFields<T extends Field>(
  fields: T[],
  data: Record<string, unknown>,
): T[] {
  return fields.filter(
    (field) =>
      isCommunityProfileField(field) &&
      (field.name !== "罩杯" || data["性别"] === "女"),
  )
}

export function communityFieldHasValue(value: unknown) {
  return (
    (typeof value === "string" || typeof value === "number") &&
    String(value).trim() !== ""
  )
}

/** Submit exactly what the preview can display, excluding stale or cleared choices. */
export function currentCommunityShareSelection(
  fields: Field[],
  data: Record<string, unknown>,
  selected: string[],
) {
  const available = new Set(
    communityShareableFields(fields, data)
      .filter((field) => communityFieldHasValue(data[field.name]))
      .map((field) => field.name),
  )
  return [...new Set(selected)].filter((name) => available.has(name))
}

export function communityProfileSection(name: string) {
  if (
    [
      "姓名",
      "性别",
      "年龄",
      "出生年月",
      "出生日",
      "民族",
      "籍贯",
      "籍贯（到市即可）",
      "婚姻状况",
    ].includes(name)
  )
    return "基本信息"
  if (name === "罪名" || name.startsWith("刑期")) return "入监信息"
  if (["健康状态", "健康状况", "技能", "职业", "文化程度"].includes(name))
    return "健康与教育"
  if (
    [
      "肤色",
      "血型",
      "脸型",
      "发际",
      "眉形",
      "眼睛",
      "鼻形",
      "嘴形",
      "唇形",
      "牙齿",
      "下巴",
      "耳形",
      "鞋码",
      "罩杯",
    ].includes(name) ||
    ["身高", "体重", "胸围", "腰围", "臀围", "肩宽", "足长", "体态备注"].some(
      (prefix) => name.startsWith(prefix),
    )
  )
    return "体态特征"
  return "其他信息"
}
