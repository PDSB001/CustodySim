import { describe, expect, it } from "vitest"

import { validateFieldPayload } from "@/lib/fields"

const fields = [
  { name: "心得", type: "TEXTAREA" as const, required: true, options: [] },
  { name: "时长", type: "NUMBER" as const, required: true, options: [] },
  {
    name: "状态",
    type: "SELECT" as const,
    required: false,
    options: ["完成", "未完成"],
  },
]

describe("task template payload validation", () => {
  it("accepts a valid structured payload", () => {
    expect(
      validateFieldPayload(fields, {
        心得: "完成学习",
        时长: 30,
        状态: "完成",
      }),
    ).toEqual({ valid: true, errors: {} })
  })

  it("requires mandatory fields", () => {
    expect(validateFieldPayload(fields, { 时长: 30 }).errors).toEqual({
      心得: "此项为必填",
    })
  })

  it("rejects invalid numeric values", () => {
    expect(
      validateFieldPayload(fields, { 心得: "完成", 时长: "abc" }).errors,
    ).toEqual({ 时长: "请输入数字" })
  })

  it("limits the optional birth day to 1 through 31", () => {
    const birthDay = [
      { name: "出生日", type: "NUMBER" as const, required: false, options: [] },
    ]
    expect(validateFieldPayload(birthDay, { 出生日: 0 }).errors).toEqual({
      出生日: "出生日必须是 1-31 的整数",
    })
    expect(validateFieldPayload(birthDay, { 出生日: 31 })).toEqual({
      valid: true,
      errors: {},
    })
  })

  it("requires birth year and month in YYYY-MM format", () => {
    const birthMonth = [
      { name: "出生年月", type: "DATE" as const, required: true, options: [] },
    ]
    expect(validateFieldPayload(birthMonth, { 出生年月: "2026-13" }).errors).toEqual({
      出生年月: "出生年月格式应为 YYYY-MM",
    })
    expect(validateFieldPayload(birthMonth, { 出生年月: "2026-08" })).toEqual({
      valid: true,
      errors: {},
    })
  })

  it("only accepts a cup size for female records", () => {
    const cup = [
      {
        name: "罩杯",
        type: "SELECT" as const,
        required: false,
        options: ["A", "B", "C", "D", "E", "F"],
      },
    ]
    expect(validateFieldPayload(cup, { 性别: "男", 罩杯: "A" }).errors).toEqual({
      罩杯: "仅性别为女时填写罩杯",
    })
    expect(validateFieldPayload(cup, { 性别: "女", 罩杯: "G" }).errors).toEqual({
      罩杯: "选项不合法",
    })
  })

  it("rejects values outside select options", () => {
    expect(
      validateFieldPayload(fields, { 心得: "完成", 时长: 30, 状态: "未知" })
        .errors,
    ).toEqual({ 状态: "选项不合法" })
  })
})
