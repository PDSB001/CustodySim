import {
  Activity,
  CheckCircle2,
  CircleDot,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react"

const metrics = [
  { label: "今日打卡率", value: "94.6%", trend: "+2.1%", icon: TrendingUp, tone: "success" as const },
  { label: "在管人数", value: "1,284", trend: "+18", icon: Users, tone: "brand" as const },
  { label: "待处理事项", value: "12", trend: "-4", icon: CircleDot, tone: "warning" as const },
]

const headlineTones = ["from-white", "via-white", "to-[color:var(--chart-3)]"] as const

export function AuthShowcase() {
  return (
    <aside className="login-showcase relative hidden flex-col justify-between gap-8 p-10 lg:flex lg:p-12">
      {/* 噪点装饰 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 noise-overlay opacity-25" />

      {/* 顶部品牌 */}
      <div className="relative flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-white/95 to-transparent bg-white/10 text-white shadow-[0_8px_28px_-8px_rgba(112,80,255,0.6)] backdrop-blur">
          <ShieldCheck className="size-[18px]" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-bold tracking-tight text-white">
            CustodySim
          </span>
          <span className="text-[9px] uppercase tracking-[0.24em] text-white/55">
            监管任务模拟系统
          </span>
        </div>
      </div>

      {/* 中部标题 + 卖点（紧凑） */}
      <div className="relative space-y-5">
        <h2 className="font-display text-[1.85rem] font-bold leading-[1.12] tracking-[-0.025em] text-white">
          让监管
          <br />
          <span className={`bg-gradient-to-r ${headlineTones.join(" ")} bg-clip-text text-transparent`}>
            透明、高效
          </span>
          <br />
          且有据可循。
        </h2>
        <p className="max-w-md text-[12px] leading-6 text-white/65">
          基于规则引擎的多角色协作平台，自动生成打卡计划、智能识别异常打卡、留存可审计的全链路证据。
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/70">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3 text-[color:var(--chart-3)]" />
            实时规则引擎
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3 text-[color:var(--info)]" />
            三角色权限
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3 text-emerald-300" />
            全链路审计
          </span>
        </div>
      </div>

      {/* 底部数据示例卡片（紧凑） */}
      <div className="relative">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/55">
              实时数据
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-300">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
              </span>
              实时同步
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
                        ? "text-[10px] font-semibold text-emerald-300"
                        : tone === "warning"
                          ? "text-[10px] font-semibold text-amber-300"
                          : "text-[10px] font-semibold text-violet-300"
                    }
                  >
                    {trend}
                  </span>
                </div>
                <div className="font-numeric text-lg font-bold leading-tight text-white">
                  {value}
                </div>
                <div className="mt-0.5 text-[10px] text-white/55">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] text-white/40">
          CustodySim · SOC 2 等保合规
        </p>
      </div>
    </aside>
  )
}