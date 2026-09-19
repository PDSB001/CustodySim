import { DailyCheckins } from "@/components/checkin/checkin-workspaces"

/**
 * 支持 ?date=YYYY-MM-DD 直达某一天。
 * 首页「今日执行」的行会带上当天日期，否则用户点进来只看到"请选择要查看的日期"。
 */
export default async function SupervisionCheckinsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = (await searchParams).date
  const date = typeof raw === "string" ? raw : undefined
  // key 让日期变化时重挂载，初始日期才会重新生效
  return <DailyCheckins key={date ?? ""} initialDate={date} />
}
