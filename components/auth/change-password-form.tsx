"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { KeyRound, LoaderCircle, Lock } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  ChangePasswordSchema,
  type ChangePasswordInput,
  SessionUserSchema,
} from "@/lib/auth-schemas"
import { getRoleHome } from "@/lib/role-routing"

const ChangePasswordResponseSchema = z
  .object({ success: z.literal(true), data: SessionUserSchema })
  .or(
    z.object({
      success: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }),
    }),
  )

export function ChangePasswordForm({
  forceChange = false,
}: {
  forceChange?: boolean
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
  })
  const onSubmit = async (values: ChangePasswordInput) => {
    setServerError(null)
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const result = ChangePasswordResponseSchema.parse(await response.json())
      if (!result.success) {
        setServerError(result.error.message)
        return
      }
      router.replace(getRoleHome(result.data.role))
      router.refresh()
    } catch {
      setServerError("密码修改失败，请稍后重试")
    }
  }
  return (
    <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="space-y-2">
        <label
          htmlFor="currentPassword"
          className="text-foreground/70 text-xs font-semibold tracking-wide"
        >
          当前密码
        </label>
        <InputGroup className="border-border/70 bg-background/80 focus-within:border-brand-500 focus-within:ring-brand-500/30 h-11 rounded-xl transition focus-within:ring-2">
          <InputGroupAddon align="inline-start">
            <KeyRound className="text-muted-foreground size-4" />
          </InputGroupAddon>
          <InputGroupInput
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...register("currentPassword")}
          />
        </InputGroup>
        {errors.currentPassword && (
          <p className="text-destructive text-xs">
            {errors.currentPassword.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <label
          htmlFor="newPassword"
          className="text-foreground/70 text-xs font-semibold tracking-wide"
        >
          新密码
        </label>
        <InputGroup className="border-border/70 bg-background/80 focus-within:border-brand-500 focus-within:ring-brand-500/30 h-11 rounded-xl transition focus-within:ring-2">
          <InputGroupAddon align="inline-start">
            <Lock className="text-muted-foreground size-4" />
          </InputGroupAddon>
          <InputGroupInput
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...register("newPassword")}
          />
        </InputGroup>
        {errors.newPassword && (
          <p className="text-destructive text-xs">
            {errors.newPassword.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <label
          htmlFor="confirmPassword"
          className="text-foreground/70 text-xs font-semibold tracking-wide"
        >
          确认新密码
        </label>
        <InputGroup className="border-border/70 bg-background/80 focus-within:border-brand-500 focus-within:ring-brand-500/30 h-11 rounded-xl transition focus-within:ring-2">
          <InputGroupAddon align="inline-start">
            <Lock className="text-muted-foreground size-4" />
          </InputGroupAddon>
          <InputGroupInput
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
        </InputGroup>
        {errors.confirmPassword && (
          <p className="text-destructive text-xs">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>
      {serverError && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-xs"
        >
          {serverError}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className="from-brand-600 hover:from-brand-700 h-11 w-full rounded-xl bg-gradient-to-r to-[color:var(--chart-5)] text-white shadow-[0_8px_24px_-8px_rgba(112,80,255,0.6)] hover:to-[color:var(--chart-5)]"
      >
        {isSubmitting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : forceChange ? (
          "设置新密码并继续"
        ) : (
          "确认修改"
        )}
      </Button>
    </form>
  )
}
