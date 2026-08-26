"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80 relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 aria-invalid:ring-3 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        data-size={size}
        className="bg-background dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground pointer-events-none block rounded-full ring-0 transition-transform data-[size=default]:size-4 data-[size=sm]:size-3 data-[size=default]:data-[state=checked]:translate-x-[14px] data-[size=sm]:data-[state=checked]:translate-x-[10px] data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
