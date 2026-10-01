import { describe, expect, it } from "vitest"
import {
  communityAuthorLabel,
  buildCommunityProfileSnapshot,
} from "@/lib/community-privacy"
import { ProfileRecordDraftSchema } from "@/lib/admin-schemas"
import { isCommunityProfileField } from "@/lib/community-contract"
import { currentCommunityShareSelection } from "@/lib/community-profile-fields"

describe("community privacy boundaries", () => {
  it("keeps the web preview and submitted selection aligned without adding newly filled fields", () => {
    const fields = [
      { name: "姓名", type: "TEXT" },
      { name: "技能", type: "TEXT" },
      { name: "年龄", type: "NUMBER" },
      { name: "罩杯", type: "TEXT" },
      { name: "照片", type: "IMAGE" },
    ]
    const data = {
      姓名: "主动选择公开",
      技能: " ",
      年龄: 0,
      性别: "男",
      罩杯: "已隐藏",
      照片: "private-photo",
    }
    const chosen = currentCommunityShareSelection(fields, data, [
      "姓名",
      "姓名",
      "技能",
      "罩杯",
      "照片",
      "旧字段",
    ])
    expect(chosen).toEqual(["姓名"])
    expect(
      currentCommunityShareSelection(
        fields,
        { ...data, 技能: "重新填写" },
        chosen,
      ),
    ).toEqual(["姓名"])
    expect(buildCommunityProfileSnapshot(fields, data, chosen)).toEqual([
      { name: "姓名", value: "主动选择公开" },
    ])
    expect(currentCommunityShareSelection(fields, data, ["年龄"])).toEqual([
      "年龄",
    ])
  })
  it("uses a stable alias inside one thread and a different alias across threads", () => {
    const secret = "community-test-secret"
    const label = communityAuthorLabel("post-a", "commenter", "author", secret)
    expect(label).toBe(
      communityAuthorLabel("post-a", "commenter", "author", secret),
    )
    expect(label).not.toBe(
      communityAuthorLabel("post-b", "commenter", "author", secret),
    )
    expect(label).not.toContain("commenter")
    expect(communityAuthorLabel("post-a", "author", "author", secret)).toBe(
      "楼主",
    )
  })
  it("publishes identity fields only when selected and never includes unrelated photos or account metadata", () => {
    const fields = [
      { name: "年龄", type: "NUMBER" },
      { name: "姓名", type: "TEXT" },
      { name: "技能", type: "TEXT" },
    ]
    const data = {
      年龄: 24,
      姓名: "真实姓名",
      技能: "绘画",
      photoData: "private-photo",
      username: "private-user",
    }
    expect(buildCommunityProfileSnapshot(fields, data, ["技能"])).toEqual([
      { name: "技能", value: "绘画" },
    ])
    expect(buildCommunityProfileSnapshot(fields, data, ["姓名"])).toEqual([
      { name: "姓名", value: "真实姓名" },
    ])
    expect(() =>
      buildCommunityProfileSnapshot(fields, data, ["username"]),
    ).toThrow()
    expect(() =>
      buildCommunityProfileSnapshot([{ name: "技能", type: "IMAGE" }], data, [
        "技能",
      ]),
    ).toThrow()
  })
  it("rejects missing/complex values and de-duplicates selected fields", () => {
    const fields = [{ name: "年龄", type: "NUMBER" }]
    expect(() => buildCommunityProfileSnapshot(fields, {}, ["年龄"])).toThrow()
    expect(() =>
      buildCommunityProfileSnapshot(fields, { 年龄: { 姓名: "隐私" } }, [
        "年龄",
      ]),
    ).toThrow()
    expect(
      buildCommunityProfileSnapshot(fields, { 年龄: 0 }, ["年龄", "年龄"]),
    ).toEqual([{ name: "年龄", value: "0" }])
  })
  it("defaults all historical and new profile drafts to no sharing", () => {
    const parsed = ProfileRecordDraftSchema.parse({
      formId: "3a168009-071a-49c8-a8da-d6b692126b22",
      data: {},
    })
    expect(parsed.communityShare).toBe(false)
    expect(parsed.communityShareFields).toEqual([])
  })
  it("accepts more than eight explicitly selected fields including newly eligible details", () => {
    const selected = [
      "性别",
      "年龄",
      "民族",
      "婚姻状况",
      "职业",
      "健康状态",
      "血型",
      "肤色",
      "鞋码",
      "肩宽（cm）",
    ]
    const data = Object.fromEntries(
      selected.map((name) => [name, "已填写内容"]),
    )
    const draft = ProfileRecordDraftSchema.parse({
      formId: "3a168009-071a-49c8-a8da-d6b692126b22",
      communityShare: true,
      communityShareFields: selected,
      data,
    })
    expect(
      buildCommunityProfileSnapshot(
        selected.map((name) => ({ name, type: "TEXT" })),
        draft.data,
        draft.communityShareFields,
      ),
    ).toEqual(selected.map((name) => ({ name, value: "已填写内容" })))
  })
  it.each([
    "姓名",
    "身份证号",
    "联系方式",
    "籍贯（到市即可）",
    "出生年月",
    "出生日",
    "罪名",
    "刑期起始日期",
    "刑期截止日期",
    "体态备注（纹身、疤痕或明显体征）",
    "自定义身份字段",
  ])(
    "allows %s only when it is a real form field explicitly selected by the user",
    (name) => {
      expect(isCommunityProfileField({ name, type: "TEXT" })).toBe(true)
      expect(
        buildCommunityProfileSnapshot(
          [{ name, type: "TEXT" }],
          { [name]: "私密内容" },
          [name],
        ),
      ).toEqual([{ name, value: "私密内容" }])
    },
  )
  it("excludes image and unsupported field types regardless of their label", () => {
    for (const type of ["IMAGE", "SIGNATURE", "STAMP", "UNKNOWN"]) {
      expect(isCommunityProfileField({ name: "职业", type })).toBe(false)
    }
  })
  it("publishes selected dates and copied text without exposing other values", () => {
    const fields = [
      { name: "出生年月", type: "DATE" },
      { name: "刑期截止日期", type: "DATE" },
      { name: "本人声明", type: "COPYWRITE" },
    ]
    expect(
      buildCommunityProfileSnapshot(
        fields,
        {
          出生年月: "1999-10",
          刑期截止日期: "2030-12-31",
          本人声明: "自愿分享",
          姓名: "未选择的姓名",
        },
        fields.map((field) => field.name),
      ),
    ).toEqual([
      { name: "出生年月", value: "1999-10" },
      { name: "刑期截止日期", value: "2030-12-31" },
      { name: "本人声明", value: "自愿分享" },
    ])
  })
  it("does not impose a fixed label whitelist or thirty-field selection limit", () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({
      name: `自定义字段${i}`,
      type: "NUMBER",
    }))
    const data = Object.fromEntries(fields.map((field, i) => [field.name, i]))
    const draft = ProfileRecordDraftSchema.parse({
      formId: "3a168009-071a-49c8-a8da-d6b692126b22",
      communityShare: true,
      communityShareFields: fields.map((field) => field.name),
      data,
    })
    expect(
      buildCommunityProfileSnapshot(
        fields,
        draft.data,
        draft.communityShareFields,
      ),
    ).toEqual(
      fields.map((field, i) => ({ name: field.name, value: String(i) })),
    )
    expect(() =>
      buildCommunityProfileSnapshot(
        fields,
        { ...data, 未在表单里的字段: "不可分享" },
        ["未在表单里的字段"],
      ),
    ).toThrow()
  })
})
