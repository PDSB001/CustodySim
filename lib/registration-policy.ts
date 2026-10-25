import { createHash } from "node:crypto"
import { z } from "zod"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"

export const REGISTRATION_GRACE_MS = 10 * 60_000
export const REGISTRATION_WINDOW_MS = 60 * 60_000
export const REGISTRATION_ATTEMPTS = 5
export function normalizeRegistrationEmail(value: string) {
  return value.normalize("NFKC").trim().toLowerCase()
}
export function registrationEmailHash(value: string) {
  return createHash("sha256")
    .update(
      `custodysim:registration-email:v1:${normalizeRegistrationEmail(value)}`,
    )
    .digest("hex")
}
export const RegistrationSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(50)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    name: z.string().trim().min(1).max(100),
    email: z
      .string()
      .transform(normalizeRegistrationEmail)
      .pipe(z.email().max(254)),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().max(128),
    acceptTrial: z.literal(true),
    captchaToken: z.string().max(2048).optional(),
  })
  .strict()
  .refine((input) => input.password === input.confirmPassword, {
    message: "两次密码不一致",
    path: ["confirmPassword"],
  })

export function probationPeriod(now: Date) {
  const midnight = new Date(`${getShanghaiDateKey(now)}T00:00:00+08:00`)
  const start = new Date(midnight.getTime() + 86400_000)
  return { start, end: new Date(start.getTime() + 7 * 86400_000) }
}
export function passesProbation(points: number) {
  return Number.isFinite(points) && points > 0
}
