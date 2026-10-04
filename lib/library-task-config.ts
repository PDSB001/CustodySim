import { z } from "zod"
import {
  getShanghaiDateAtTime,
  getShanghaiDateKey,
} from "@/lib/shanghai-datetime"

const Fields = z.object({
  name: z.string().trim().min(1).max(100),
  readingMinutes: z.number().int().min(1).max(1440),
  timeSlot: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeoutMinutes: z.number().int().min(1).max(10080),
})
export const ReadingRuleCreate = Fields.extend({
  userId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
})
  .refine(
    (value) => value.readingMinutes <= value.timeoutMinutes,
    "阅读要求不能超过任务有效时长",
  )
  .refine(
    (value) => !(value.userId && value.groupId),
    "请选择被监管人或任务组中的一种范围",
  )
export const ReadingRuleUpdate = Fields.partial()
  .extend({ enabled: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "请填写要修改的设置")

/** A daily rule starts at its next Shanghai slot, avoiding retroactive overdue tasks. */
export function nextReadingRuleStart(timeSlot: string, now = new Date()) {
  const today = getShanghaiDateAtTime(now, timeSlot)
  const date =
    today.getTime() < now.getTime() ? new Date(now.getTime() + 86400000) : now
  return new Date(`${getShanghaiDateKey(date)}T00:00:00+08:00`)
}
