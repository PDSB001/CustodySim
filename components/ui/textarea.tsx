import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-slate-200 placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-ring/15 disabled:bg-slate-100 aria-invalid:border-destructive aria-invalid:ring-destructive/15 flex field-sizing-content min-h-24 w-full rounded-xl border bg-white px-3.5 py-3 text-base leading-6 shadow-[0_1px_1px_rgba(15,23,42,0.02)] transition-[border-color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
