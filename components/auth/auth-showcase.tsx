import {
  Activity,
  CheckCircle2,
  CircleDot,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react"

const metrics = [
  {
    label: "按时点名",
    value: "报到",
    trend: "01",
    icon: TrendingUp,
    tone: "success" as const,
  },
  {
    label: "完成任务",
    value: "呈报",
    trend: "02",
    icon: Users,
    tone: "brand" as const,
  },
  {
    label: "查阅意见",
    value: "批阅",
    trend: "03",
    icon: CircleDot,
    tone: "warning" as const,
  },
]

const headlineTones = [
  "from-white",
  "via-white",
  "to-[color:var(--chart-3)]",
] as const

export function AuthShowcase() {
  return (
    <aside className="login-showcase relative hidden flex-col justify-between gap-8 p-10 lg:flex lg:p-12">
      {/* 噪点装饰 */}
      <div
        aria-hidden
        className="noise-overlay pointer-events-none absolute inset-0 opacity-25"
      />

      {/* 顶部品牌 */}
      <div className="relative flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-white/10 bg-gradient-to-br from-white/95 to-transparent text-white shadow-[0_8px_28px_-8px_rgba(112,80,255,0.6)] backdrop-blur">
          <ShieldCheck className="size-[18px]" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-bold tracking-tight text-white">
            CustodySim
          </span>
          <span className="text-[11px] tracking-[0.16em] text-white/55 uppercase">
            监管任务模拟系统
          </span>
        </div>
      </div>

      {/* 中部标题 + 卖点（紧凑） */}
      <div className="relative space-y-5">
        <h2 className="font-display text-[1.85rem] leading-[1.12] font-bold tracking-[-0.025em] text-white">
          监室里的每一天
          <br />
          <span
            className={`bg-gradient-to-r ${headlineTones.join(" ")} bg-clip-text text-transparent`}
          >
            按时点名，依规执行
          </span>
          <br />
          每一步，都有记录。
        </h2>
        <p className="max-w-md text-sm leading-6 text-white/65">
          从入所档案到每日任务，从点名报到到纪律积分，在 CustodySim
          中体验有规程、有记录的模拟服刑生活。
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/70">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3 text-[color:var(--chart-3)]" />
            每日执行
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3 text-[color:var(--info)]" />
            监室生活
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3 text-emerald-300" />
            纪律记录
          </span>
        </div>
      </div>

      {/* 底部数据示例卡片（紧凑） */}
      <div className="relative">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs tracking-[0.14em] text-white/55 uppercase">
              每日执行流程
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
              </span>
              模拟监禁
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {metrics.map(({ icon: Icon, label, value, trend, tone }) => (
              <div
                key={label}
                className="rounded-xl bg-gradient-to-b from-white/10 to-white/0 p-2.5"
              >
                <div className="mb-1 flex items-center justify-between">
                  <Icon
                    className={
                      tone === "success"
                        ? "size-3.5 text-emerald-300"
                        : tone === "warning"
                          ? "size-3.5 text-amber-300"
                          : "size-3.5 text-violet-300"
                    }
                  />
                  <span
                    className={
                      tone === "success"
                        ? "text-xs font-semibold text-emerald-300"
                        : tone === "warning"
                          ? "text-xs font-semibold text-amber-300"
                          : "text-xs font-semibold text-violet-300"
                    }
                  >
                    {trend}
                  </span>
                </div>
                <div className="font-numeric text-lg leading-tight font-bold text-white">
                  {value}
                </div>
                <div className="mt-0.5 text-xs text-white/55">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-white/50">
          CustodySim · 监室日程与监管记录
        </p>
      </div>
    </aside>
  )
}
