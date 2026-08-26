import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-ring/15 aria-invalid:border-destructive aria-invalid:ring-destructive/15 h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 text-base shadow-[0_1px_1px_rgba(15,23,42,0.02)] transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
