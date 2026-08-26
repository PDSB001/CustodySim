import { z } from "zod"

export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "SELECT",
  "DATE",
  "COPYWRITE",
] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export type FieldDef = {
  name: string
  type: FieldType
  required: boolean
  options: string[]
}

/** 抄写字段的原文，约定存于 options[0] */
export function getCopywriteSource(field: FieldDef) {
  return (field.options?.[0] ?? "").trim()
}

export function validateFieldPayload(
  fields: FieldDef[],
  payload: Record<string, unknown>,
) {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = payload[field.name]
    if (
      field.required &&
      (value === undefined || value === null || value === "")
    )
      errors[field.name] = "此项为必填"
    if (value === undefined || value === null || value === "") continue
    if (field.type === "NUMBER" && Number.isNaN(Number(value)))
      errors[field.name] = "请输入数字"
    if (field.name === "出生日") {
      const day = Number(value)
      if (!Number.isInteger(day) || day < 1 || day > 31)
        errors[field.name] = "出生日必须是 1-31 的整数"
    }
    if (
      field.name === "出生年月" &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))
    )
      errors[field.name] = "出生年月格式应为 YYYY-MM"
    if (field.type === "SELECT" && !field.options.includes(String(value)))
      errors[field.name] = "选项不合法"
    if (field.name === "罩杯" && payload["性别"] !== "女")
      errors[field.name] = "仅性别为女时填写罩杯"
    if (field.type === "COPYWRITE") {
      const source = getCopywriteSource(field)
      const written = String(value).trim()
      if (!source)
        errors[field.name] = "模板未配置抄写原文"
      else if (written !== source)
        errors[field.name] = "抄写内容与原文不一致"
    }
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

export const TaskPayloadSchema = z.record(z.string(), z.unknown())
