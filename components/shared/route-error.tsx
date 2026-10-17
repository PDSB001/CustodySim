"use client"

import { Button } from "@/components/ui/button"
import styles from "./route-error.module.css"

export type RouteErrorProps = {
  error: Error & { digest?: string }
  retry: () => void
}

export default function RouteError({ error, retry }: RouteErrorProps) {
  return (
    <section role="alert" className={styles.panel}>
      <title>页面暂时无法加载 · CustodySim</title>
      <h1 className={styles.title}>页面暂时无法加载</h1>
      <p className={styles.message}>请稍后重试。若仍无法打开，请联系管理员。</p>
      {error.digest && (
        <p className={styles.digest}>错误编号：{error.digest}</p>
      )}
      <Button type="button" onClick={retry} className={styles.retry}>
        重新加载
      </Button>
    </section>
  )
}
