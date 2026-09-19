import {
  Activity,
  CheckCircle2,
  CircleDot,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react"

const metrics = [
  { label: "按时点名", value: "报到", trend: "01", icon: TrendingUp },
  { label: "完成任务", value: "呈报", trend: "02", icon: Users },
  { label: "查阅意见", value: "批阅", trend: "03", icon: CircleDot },
]

const headlineTones = [
  "from-white",
  "via-white",
  "to-[color:var(--chart-3)]",
] as const

export function AuthShowcase() {
  return (
    <aside className="login-showcase relative hidden flex-col justify-center gap-6 p-9 lg:flex lg:p-10 xl:p-11">
      {/* 顶部品牌 */}
      <div className="relative flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-white/95 to-transparent text-white shadow-[0_8px_28px_-8px_rgba(112,80,255,0.6)] backdrop-blur">
          <ShieldCheck className="size-[18px]" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-bold tracking-tight text-white">
            CustodySim
          </span>
          <span className="text-[11px] tracking-[0.16em] text-white/60 uppercase">
            监管任务模拟系统
          </span>
        </div>
      </div>

      {/* 中部标题 + 说明（左侧最大视觉元素） */}
      <div className="relative space-y-4">
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
        <p className="max-w-md text-sm leading-6 text-white/75">
          从入所档案到每日任务，从点名报到到纪律积分，在 CustodySim
          中体验有规程、有记录的模拟服刑生活。
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/75">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3 text-[color:var(--chart-3)]" />
            每日执行
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3 text-white/60" />
            监室生活
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3 text-white/60" />
            纪律记录
          </span>
        </div>
      </div>

      {/* 底部执行流程（三个节点统一为同一套视觉关系，不再各用一个强调色） */}
      <div className="relative">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] tracking-[0.14em] text-white/60 uppercase">
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
            {metrics.map(({ icon: Icon, label, value, trend }) => (
              <div
                key={label}
                className="rounded-lg border border-white/10 bg-white/[0.06] p-2.5"
              >
                <div className="mb-1 flex items-center justify-between">
                  <Icon className="size-3.5 text-white/70" />
                  <span className="font-numeric text-[11px] font-semibold text-white/50">
                    {trend}
                  </span>
                </div>
                <div className="font-numeric text-base leading-tight font-semibold text-white">
                  {value}
                </div>
                <div className="mt-0.5 text-[11px] text-white/60">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2.5 text-center text-[11px] text-white/55">
          CustodySim · 监室日程与监管记录
        </p>
      </div>
    </aside>
  )
}
