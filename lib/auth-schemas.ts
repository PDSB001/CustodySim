import { z } from "zod"

import { ROLES } from "@/lib/constants"

export const SessionUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  role: z.enum(ROLES),
  organizationId: z.string().uuid().nullable(),
  mustChangePassword: z.boolean(),
})

export const LoginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名").max(50),
  password: z.string().min(1, "请输入密码").max(128),
})

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码").max(128),
    newPassword: z
      .string()
      .min(8, "新密码至少需要 8 位")
      .max(128, "新密码不能超过 128 位")
      .regex(/[A-Za-z]/, "新密码至少包含一个字母")
      .regex(/\d/, "新密码至少包含一个数字"),
    confirmPassword: z.string().min(1, "请再次输入新密码").max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  })

export type LoginInput = z.infer<typeof LoginSchema>
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>
