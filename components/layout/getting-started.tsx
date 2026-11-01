"use client"

import { CircleHelp, Smartphone } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SessionUser } from "@/lib/session"

const steps = {
  SUPERVISED: [
    ["先查看今天的安排", "在监室首页查看待办和通知，按点名时段完成打卡。"],
    [
      "办理任务与申请",
      "在服刑任务中提交内容、查看结果；需要补卡或提出申请时，按页面提示办理。",
    ],
    [
      "阅读与联系",
      "使用图书馆、监室通信和匿名社区；分享档案前先检查选择的内容。",
    ],
  ],
  SUPERVISOR: [
    ["查看执勤总览", "从值班室查看待办，按监管范围处理工作。"],
    [
      "审核与跟进",
      "在审核工作台处理任务和补卡，在点名记录与申请审查中跟进进度。",
    ],
    [
      "联系与查阅",
      "使用通知、通信、图书馆和档案会签，具体可见范围由服务端权限决定。",
    ],
  ],
  ADMIN: [
    [
      "配置组织与账号",
      "从组织架构、账户管理和监管关系开始，确认人员归属与权限。",
    ],
    [
      "设置业务规则",
      "配置任务编排、打卡规则和图书馆，再通过审核工作台跟进执行。",
    ],
    [
      "检查安全与联络",
      "使用通知、聊天监管及审计日志；生产环境请先核对部署与备份。",
    ],
  ],
} as const

export function GettingStarted({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const key = `custodysim:guide:v1:${user.id}:${user.role}`
  const items = steps[user.role]
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (!localStorage.getItem(key)) setOpen(true)
      } catch {
        /* Manual access remains available. */
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [key])
  function close() {
    try {
      localStorage.setItem(key, "seen")
    } catch {
      /* Storage may be disabled. */
    }
    setOpen(false)
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="打开新手引导"
        onClick={() => {
          setStep(0)
          setOpen(true)
        }}
      >
        <CircleHelp />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
          else setOpen(true)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <p className="text-primary text-xs font-semibold">
              新手引导 · {step + 1} / {items.length}
            </p>
            <DialogTitle className="text-xl">{items[step][0]}</DialogTitle>
            <DialogDescription>{items[step][1]}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            使用左侧导航切换功能；手机上可点击左上角菜单。遇到问题请联系管理员。
          </p>
          <Link
            href="/download"
            className="text-primary inline-flex items-center gap-2 text-sm underline"
            onClick={close}
          >
            <Smartphone className="size-4" />
            了解 Android App
          </Link>
          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={close}>
              跳过
            </Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  上一步
                </Button>
              )}
              <Button
                onClick={() =>
                  step === items.length - 1 ? close() : setStep(step + 1)
                }
              >
                {step === items.length - 1 ? "开始使用" : "下一步"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
