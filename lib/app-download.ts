import "server-only"
import { stat } from "node:fs/promises"
import path from "node:path"
import { downloadVersion } from "@/lib/download-version"

// These fixed filenames are managed by the operator; requests never choose paths.
const files = { apk: "CustodySim.apk" } as const
export type DownloadKind = keyof typeof files

export function appDownloadPath(kind: DownloadKind) {
  return path.join(
    /* turbopackIgnore: true */
    process.env.APP_RELEASE_DIR ||
      path.join(process.cwd(), "data", "app-release"),
    files[kind],
  )
}

export async function appDownloadAvailable(kind: DownloadKind) {
  try {
    // Operator-managed runtime files must not be copied into standalone output.
    return (
      await stat(/* turbopackIgnore: true */ appDownloadPath(kind))
    ).isFile()
  } catch {
    return false
  }
}

export async function appDownloadUrl(kind: DownloadKind) {
  try {
    const info = await stat(/* turbopackIgnore: true */ appDownloadPath(kind), {
      bigint: true,
    })
    return info.isFile()
      ? `/api/app-download/${kind}?v=${downloadVersion(info)}`
      : null
  } catch {
    return null
  }
}
