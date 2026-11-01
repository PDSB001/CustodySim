import { ArrowDownToLine, CheckCircle2, Smartphone } from "lucide-react"
import Link from "next/link"
import { appDownloadUrl } from "@/lib/app-download"

export const dynamic = "force-dynamic"

export default async function DownloadPage() {
  const apk = await appDownloadUrl("apk")
  return (
    <main className="mesh-bg-strong min-h-svh px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-4xl space-y-8">
        <Link href="/login" className="text-muted-foreground text-sm underline">
          返回登录
        </Link>
        <section className="bg-card rounded-3xl border p-7 shadow-lg sm:p-12">
          <div className="text-primary bg-primary/10 mb-6 flex size-14 items-center justify-center rounded-2xl">
            <Smartphone className="size-7" />
          </div>
          <p className="text-primary text-sm font-semibold">
            CUSTODYSIM FOR ANDROID
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            把日常事务带在身边
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl leading-7">
            在 Android 手机上的 CustodySim
            查看任务和通知、打卡、阅读及联系其他用户。使用与 Web
            相同的账号登录。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {apk ? (
              <Link
                href={apk}
                prefetch={false}
                download
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center gap-2 rounded-xl px-5 font-medium"
              >
                <ArrowDownToLine className="size-4" />
                下载 Android 安装包
              </Link>
            ) : (
              <span className="bg-muted text-muted-foreground rounded-xl px-5 py-3 text-sm">
                安装包暂未发布，请联系管理员
              </span>
            )}
          </div>
        </section>
        <section className="bg-card rounded-2xl border p-6">
          <h2 className="font-semibold">iOS 开发中</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            iOS 版本正在开发，暂未提供下载。你可以先通过浏览器使用 Web 端。
          </p>
        </section>
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            ["1", "下载安装", "下载后打开 APK，按系统提示完成安装。"],
            ["2", "选择服务器", "按管理员提供的信息检查服务器设置。"],
            [
              "3",
              "登录账号",
              "使用现有账号登录；如需更改初始密码，请先在 Web 完成。",
            ],
          ].map(([n, title, body]) => (
            <div key={n} className="bg-card rounded-2xl border p-6">
              <div className="text-primary flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="size-4" />
                {n} / {title}
              </div>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                {body}
              </p>
            </div>
          ))}
        </section>
        <p className="text-muted-foreground text-xs leading-6">
          仅适用于
          Android。请从可信的服务提供者获取安装包；升级安装需要与已安装版本使用兼容的应用
          ID 和签名。
        </p>
      </div>
    </main>
  )
}
