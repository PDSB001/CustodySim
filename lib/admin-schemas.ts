import { z } from "zod"

import {
  CUSTODY_LEVELS,
  ORGANIZATION_CATEGORIES,
  PRISONER_CUSTODY_STATUSES,
} from "@/lib/constants"
import { APPLICATION_TYPES } from "@/lib/application"
import { OFFICIAL_SEAL_KINDS } from "@/lib/official-seal"
import { parseIso } from "@/lib/shanghai-datetime"

export const OrganizationSchema = z.object({
  name: z.string().trim().min(1, "请输入组织名称").max(100),
  parentId: z.string().uuid().nullable().optional(),
  category: z.enum(ORGANIZATION_CATEGORIES),
  sort: z.coerce.number().int().min(0).max(99999).default(0),
})

export const UserCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, "用户名仅支持字母、数字及 ._-"),
  name: z.string().trim().min(1).max(100),
  role: z.enum(["ADMIN", "SUPERVISOR", "SUPERVISED"]),
  password: z.string().min(8).max(128),
  organizationId: z.string().uuid().nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
})

export const UserUpdateSchema = UserCreateSchema.omit({
  username: true,
  password: true,
}).extend({ status: z.enum(["active", "disabled"]).optional() })
export const ResetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
})

export const PersonSchema = z.object({
  name: z.string().trim().min(1).max(100),
  gender: z.enum(["男", "女", "其他"]).nullable().optional(),
  age: z.coerce.number().int().min(0).max(150).nullable().optional(),
  personType: z.enum(["SUPERVISED", "OTHER"]).default("SUPERVISED"),
  prisonerNumber: z.string().trim().max(50).nullable().optional(),
  customNumber: z.string().trim().max(50).nullable().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  treatmentLevel: z.string().trim().max(50).nullable().optional(),
  nativePlace: z.string().trim().max(100).nullable().optional(),
  level: z.string().trim().max(50).nullable().optional(),
  evaluation: z.string().trim().max(100).nullable().optional(),
  chargeName: z.string().trim().max(300).nullable().optional(),
  sentenceStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "刑期起始日期格式不合法")
    .nullable()
    .optional(),
  sentenceEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "刑期截止日期格式不合法")
    .nullable()
    .optional(),
  custodyLevel: z.enum(CUSTODY_LEVELS).default("GENERAL"),
  custodyStatus: z.enum(PRISONER_CUSTODY_STATUSES).default("OUT_OF_CUSTODY"),
  remark: z.string().trim().max(1000).nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
})

export const CustodyProfileSchema = z.object({
  custodyLevel: z.enum(CUSTODY_LEVELS),
  custodyStatus: z.enum(PRISONER_CUSTODY_STATUSES),
})

export const NumberingRuleSchema = z.object({
  prefix: z.string().trim().max(30),
  dateFormat: z.enum(["NONE", "yyyy", "yyyyMM", "yyyyMMdd"]),
  generationMode: z.enum(["RANDOM", "SEQUENTIAL"]),
  minLength: z.coerce.number().int().min(2).max(10),
  randomLength: z.coerce.number().int().min(4).max(12),
})

export const PrisonerNumberSchema = z.object({
  personId: z.string().uuid(),
  number: z.string().trim().min(1).max(50).optional(),
  reason: z.string().trim().max(500).optional(),
})

const ScopeSchema = z.object({
  targetType: z.enum(["USER", "ORG"]),
  targetId: z.string().uuid(),
})

export const SupervisionRelationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: z.enum(["active", "inactive"]).default("active"),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  supervisorScopes: z.array(ScopeSchema).min(1, "至少指定一名监管方"),
  supervisedScopes: z.array(ScopeSchema).min(1, "至少指定一名被监管方"),
})

export const RuleGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  remark: z.string().trim().max(500).nullable().optional(),
  scopes: z.array(ScopeSchema).default([]),
})

export const RuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["REPORT", "STUDY", "LABOR"]).default("REPORT"),
  taskType: z.enum(["REPORT", "STUDY", "LABOR"]).default("REPORT"),
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ONCE"]).default("DAILY"),
  scheduleDays: z.array(z.coerce.number().int().min(1).max(31)).default([]),
  timeSlots: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).default([]),
  timeoutMinutes: z.coerce.number().int().min(1).max(10080).default(30),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  ruleGroupId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().default(true),
  scopes: z.array(ScopeSchema).default([]),
})

export const CheckinRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ONCE"]).default("DAILY"),
  scheduleDays: z.array(z.coerce.number().int().min(1).max(31)).default([]),
  timeSlots: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
    .min(1, "至少设置一个打卡时段"),
  timeoutMinutes: z.coerce.number().int().min(1).max(10080).default(30),
  custodyLevel: z.enum(CUSTODY_LEVELS).nullable().optional(),
  slotSettings: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        timeoutMinutes: z.coerce.number().int().min(1).max(10080),
      }),
    )
    .default([]),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  ruleGroupId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().default(true),
  needLocation: z.boolean().default(false),
  allowNoLocation: z.boolean().default(true),
  needRemark: z.boolean().default(false),
  scopes: z.array(ScopeSchema).default([]),
})

export const UiConfigSchema = z.object({
  scope: z.enum(["SUPERVISOR", "SUPERVISED"]),
  homeTitle: z.string().trim().max(200),
  homeSubtitle: z.string().trim().max(500),
  homeBanner: z.string().trim().max(2000),
})

export const ReportTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["REPORT", "STUDY", "LABOR"]),
  content: z.string().trim().max(2000).nullable().optional(),
  fields: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        type: z.enum([
          "TEXT",
          "TEXTAREA",
          "NUMBER",
          "SELECT",
          "DATE",
          "COPYWRITE",
          "IMAGE",
        ]),
        required: z.boolean().default(false),
        options: z.array(z.string().trim().min(1).max(2000)).default([]),
      }),
    )
    .min(1, "至少设计一个字段"),
})

const ProfileFieldSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "SELECT", "DATE", "COPYWRITE", "IMAGE"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(2000)).default([]),
})

export const ProfileFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  targetType: z.literal("SUPERVISED").default("SUPERVISED"),
  content: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().default(true),
  fields: z.array(ProfileFieldSchema).min(1, "至少设计一个字段"),
})

export const ProfileRecordDraftSchema = z.object({
  formId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
  photoData: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,/, "照片格式不合法")
    .max(2_800_000, "照片不能超过 2MB")
    .nullable()
    .optional(),
  signatureMode: z.enum(["GENERATED", "HANDWRITTEN"]).default("GENERATED"),
  handwrittenSignatureData: z
    .string()
    .regex(/^data:image\/png;base64,/, "手写签名格式不合法")
    .max(750_000, "手写签名图片过大")
    .nullable()
    .optional(),
})

export const ProfileReviewSchema = z.object({
  result: z.enum(["APPROVED", "RETURNED"]),
  grade: z.coerce.number().int().min(0).max(100).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
})

// 私有日期时间控件输出格式：YYYY-MM-DDTHH:mm[:ss]（无时区，后端视为上海 +08:00）
const DATETIME_LOCAL_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

export const ApplicationDraftSchema = z
  .object({
    type: z.enum(APPLICATION_TYPES),
    reason: z.string().trim().min(1, "请填写申请事由").max(2000),
    leaveStartAt: z.string().regex(DATETIME_LOCAL_REGEX).nullable().optional(),
    leaveEndAt: z.string().regex(DATETIME_LOCAL_REGEX).nullable().optional(),
    temporaryReleaseStartAt: z.string().regex(DATETIME_LOCAL_REGEX).nullable().optional(),
    temporaryReleaseEndAt: z.string().regex(DATETIME_LOCAL_REGEX).nullable().optional(),
    archiveRecordId: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.type === "LEAVE") {
      const startAt = parseIso(
        typeof value.leaveStartAt === "string"
          ? `${value.leaveStartAt}+08:00`
          : null,
      )
      const endAt = parseIso(
        typeof value.leaveEndAt === "string" ? `${value.leaveEndAt}+08:00` : null,
      )
      if (!value.leaveStartAt || !value.leaveEndAt) {
        context.addIssue({ code: "custom", message: "请填写请假起止时间" })
      } else if (!startAt || !endAt) {
        context.addIssue({ code: "custom", message: "请假时间格式不正确" })
      } else if (endAt.getTime() <= startAt.getTime()) {
        context.addIssue({ code: "custom", message: "请假结束时间必须晚于开始时间" })
      }
    }
    if (value.type === "TEMPORARY_OUT_OF_CUSTODY") {
      const startAt = parseIso(
        typeof value.temporaryReleaseStartAt === "string"
          ? `${value.temporaryReleaseStartAt}+08:00`
          : null,
      )
      const endAt = parseIso(
        typeof value.temporaryReleaseEndAt === "string"
          ? `${value.temporaryReleaseEndAt}+08:00`
          : null,
      )
      if (!value.temporaryReleaseStartAt || !value.temporaryReleaseEndAt) {
        context.addIssue({ code: "custom", message: "请填写临时离监起止时间" })
      } else if (!startAt || !endAt) {
        context.addIssue({ code: "custom", message: "离监时间格式不正确" })
      } else if (endAt.getTime() <= startAt.getTime()) {
        context.addIssue({ code: "custom", message: "离监结束时间必须晚于开始时间" })
      }
    }
    if (value.type === "SENTENCE_REDUCTION" && !value.archiveRecordId)
      context.addIssue({ code: "custom", message: "减刑申请必须关联已归档档案" })
  })

export const ElectronicFenceSchema = z.object({
  name: z.string().trim().min(1, "请输入围栏名称").max(100),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(50).max(50_000),
  boundaryPoints: z.array(z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  })).max(20).default([]),
  enabled: z.boolean().default(true),
})

export const GeofenceEvaluationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().min(0).max(10_000),
  capturedAt: z.string().datetime({ offset: true }),
  coordinateSystem: z.literal("GCJ02"),
})

export const ApplicationReviewSchema = z.object({
  result: z.enum(["APPROVED", "RETURNED", "REJECTED"]),
  comment: z.string().trim().max(2000).nullable().optional(),
})

export const ArchiveBoxSchema = z.object({
  name: z.string().trim().min(1).max(100),
  remark: z.string().trim().max(1000).nullable().optional(),
})

export const OfficialSealSchema = z.object({
  kind: z.enum(OFFICIAL_SEAL_KINDS),
  organizationName: z.string().trim().min(1).max(100),
  sealText: z.string().trim().min(1).max(100),
  active: z.boolean().default(true),
})

export const NoticeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(5000),
  targetRole: z.enum(["ALL", "SUPERVISED", "SUPERVISOR"]),
  priority: z.enum(["NORMAL", "IMPORTANT", "URGENT"]).default("NORMAL"),
  published: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().optional(),
})
