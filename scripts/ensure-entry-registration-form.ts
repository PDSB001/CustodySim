import { and, eq } from "drizzle-orm"

import { db } from "../lib/db"
import { profileFields, profileForms, profileRecords } from "../lib/db/schema"

const FORM_NAME = "入监登记表"

const fields = [
  { name: "姓名", type: "TEXT", required: true, options: [] },
  { name: "性别", type: "SELECT", required: true, options: ["男", "女", "其他"] },
  {
    name: "罩杯",
    type: "SELECT",
    required: false,
    options: ["A", "B", "C", "D", "E", "F"],
  },
  { name: "年龄", type: "NUMBER", required: true, options: [] },
  {
    name: "出生年月",
    type: "DATE",
    required: true,
    options: [],
  },
  { name: "民族", type: "TEXT", required: true, options: [] },
  { name: "籍贯（到市即可）", type: "TEXT", required: true, options: [] },
  {
    name: "婚姻状况",
    type: "SELECT",
    required: true,
    options: ["未婚", "已婚", "离异", "丧偶", "其他"],
  },
  { name: "罪名", type: "TEXT", required: true, options: [] },
  { name: "刑期", type: "TEXT", required: true, options: [] },
  {
    name: "出生日",
    type: "NUMBER",
    required: false,
    options: [],
  },
  {
    name: "健康状态",
    type: "SELECT",
    required: false,
    options: ["良好", "一般", "较差"],
  },
  { name: "技能", type: "TEXT", required: false, options: [] },
  { name: "职业", type: "TEXT", required: false, options: [] },
  {
    name: "文化程度",
    type: "SELECT",
    required: false,
    options: ["小学", "初中", "高中", "中专/技校", "大专", "本科", "研究生及以上", "其他"],
  },
  { name: "身高（cm）", type: "NUMBER", required: false, options: [] },
  { name: "体重（kg）", type: "NUMBER", required: false, options: [] },
  { name: "肤色", type: "SELECT", required: false, options: ["白", "偏白", "黄", "偏黑", "黑", "其他"] },
  { name: "血型", type: "SELECT", required: false, options: ["A", "B", "AB", "O", "其他"] },
  { name: "脸型", type: "SELECT", required: false, options: ["圆", "方", "长", "椭圆", "其他"] },
  { name: "发际", type: "SELECT", required: false, options: ["直", "高", "低", "其他"] },
  { name: "眉形", type: "SELECT", required: false, options: ["平", "弯", "浓", "淡", "其他"] },
  { name: "眼睛", type: "SELECT", required: false, options: ["圆", "杏", "细长", "其他"] },
  { name: "鼻形", type: "SELECT", required: false, options: ["直", "塌", "鹰钩", "其他"] },
  { name: "嘴形", type: "SELECT", required: false, options: ["大", "小", "适中", "其他"] },
  { name: "唇形", type: "SELECT", required: false, options: ["薄", "厚", "适中", "其他"] },
  { name: "牙齿", type: "SELECT", required: false, options: ["齐", "不齐", "缺损", "其他"] },
  { name: "下巴", type: "SELECT", required: false, options: ["尖", "圆", "方", "其他"] },
  { name: "耳形", type: "SELECT", required: false, options: ["大", "小", "正常", "其他"] },
  { name: "胸围（cm）", type: "NUMBER", required: false, options: [] },
  { name: "腰围（cm）", type: "NUMBER", required: false, options: [] },
  { name: "臀围（cm）", type: "NUMBER", required: false, options: [] },
  { name: "肩宽（cm）", type: "NUMBER", required: false, options: [] },
  { name: "足长（cm）", type: "NUMBER", required: false, options: [] },
  { name: "鞋码", type: "NUMBER", required: false, options: [] },
  {
    name: "体态备注（纹身、疤痕或明显体征）",
    type: "TEXTAREA",
    required: false,
    options: [],
  },
] as const

const content =
  "本表用于入监登记。带红色星号的项目为必填；出生年月使用年月选择器，出生日为可选的 1–31 日数字。体态特征按实际情况填写，电子签名位于表格末端，管理处公章由管理员最终审批时加盖。"

async function main() {
  const [existing] = await db
    .select()
    .from(profileForms)
    .where(
      and(eq(profileForms.name, FORM_NAME), eq(profileForms.targetType, "SUPERVISED")),
    )
    .limit(1)

  if (existing) {
    const records = await db
      .select({ id: profileRecords.id })
      .from(profileRecords)
      .where(eq(profileRecords.formId, existing.id))
    if (records.length > 0) {
      console.log(`已保留 ${FORM_NAME}：存在 ${records.length} 条历史档案，未覆盖字段定义。`)
      return
    }
    await db.transaction(async (tx) => {
      await tx
        .update(profileForms)
        .set({ content, active: true, updatedAt: new Date() })
        .where(eq(profileForms.id, existing.id))
      await tx.delete(profileFields).where(eq(profileFields.formId, existing.id))
      await tx.insert(profileFields).values(
        fields.map((field, sort) => ({ ...field, formId: existing.id, sort })),
      )
    })
    console.log(`已更新固定表单：${FORM_NAME}`)
    return
  }

  await db.transaction(async (tx) => {
    const [form] = await tx
      .insert(profileForms)
      .values({ name: FORM_NAME, targetType: "SUPERVISED", content, active: true })
      .returning({ id: profileForms.id })
    if (!form) throw new Error("创建入监登记表失败")
    await tx.insert(profileFields).values(
      fields.map((field, sort) => ({ ...field, formId: form.id, sort })),
    )
  })
  console.log(`已创建固定表单：${FORM_NAME}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
