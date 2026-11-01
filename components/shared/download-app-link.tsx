import Link from "next/link"
import { Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"

export function DownloadAppLink() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/download">
        <Smartphone aria-hidden="true" />
        下载 App
      </Link>
    </Button>
  )
}
