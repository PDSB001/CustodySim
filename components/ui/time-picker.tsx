"use client"

import { useState } from "react"
import { ChevronDown, Clock3 } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
)
const MINUTES = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
)

function splitTime(value: string) {
  const [hour = "00", minute = "00"] = value.split(":")
  return { hour, minute }
}

export function TimePicker({
  value,
  onValueChange,
  disabled = false,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const { hour, minute } = splitTime(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`打卡时间：${value}`}
          className={cn(
            "border-input bg-background text-foreground shadow-soft hover:border-brand-500/35 focus-visible:border-ring focus-visible:ring-ring/15 flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm transition-[border-color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="flex items-center gap-2">
            <Clock3 className="text-muted-foreground size-4" />
            <span className="font-numeric font-medium">{value}</span>
          </span>
          <ChevronDown className="text-muted-foreground size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="border-border shadow-pop w-[19.5rem] gap-0 overflow-hidden rounded-xl border p-0"
      >
        <div className="bg-muted/45 border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">选择打卡时间</span>
          <span className="font-numeric text-brand-700 text-sm font-semibold">
            {value}
          </span>
        </div>
        <div className="divide-border grid grid-cols-2 divide-x">
          <TimeUnitOptions
            label="小时"
            options={HOURS}
            selected={hour}
            onSelect={(nextHour) => onValueChange(`${nextHour}:${minute}`)}
          />
          <TimeUnitOptions
            label="分钟"
            options={MINUTES}
            selected={minute}
            onSelect={(nextMinute) => {
              onValueChange(`${hour}:${nextMinute}`)
              setOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimeUnitOptions({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: string[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <section className="min-w-0 p-3" aria-label={label}>
      <h3 className="text-muted-foreground mb-2 px-1 text-xs font-medium">
        {label}
      </h3>
      <div className="grid max-h-48 grid-cols-4 gap-1 overflow-y-auto pr-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={selected === option}
            onClick={() => onSelect(option)}
            className={cn(
              "font-numeric h-8 rounded-md text-xs font-medium transition-colors",
              selected === option
                ? "bg-brand-500 text-white shadow-sm"
                : "hover:bg-brand-500/10 hover:text-brand-800",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  )
}
