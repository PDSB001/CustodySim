import {
  GEOIP_SOURCE_REPOSITORY,
  updateGeoIpDatabase,
} from "@/lib/geoip-updater"
import { describeGeoIpDatabase } from "@/lib/geoip-database"

/**
 * 手动 / 部署时更新本地合并 IP 库。
 *
 * 运行中的应用也会按 GEOIP_AUTO_UPDATE=true 每周自动执行同一段逻辑，
 * 这个入口主要给首次部署、排查和 CI 预置数据用。
 */
async function main() {
  const result = await updateGeoIpDatabase({
    log: (message) => process.stdout.write(message + "\n"),
  })

  if (result.status === "updated") {
    process.stdout.write("数据库位置：" + result.databasePath + "\n")
  } else if (result.status === "up-to-date") {
    process.stdout.write(
      "已是最新（" +
        (result.tag ?? result.sha256?.slice(0, 12) ?? "未知版本") +
        "，更新于 " +
        (result.downloadedAt ?? "未知时间") +
        "）。\n",
    )
  } else {
    process.stdout.write("跳过本次更新：" + result.reason + "\n")
  }

  const database = describeGeoIpDatabase()
  if (!database.available) {
    process.stderr.write(
      "警告：更新后仍无法加载数据库，" +
        database.path +
        "；请检查数据源 " +
        GEOIP_SOURCE_REPOSITORY +
        " 是否可访问。\n",
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(
    "数据库自检通过：" +
      database.databaseType +
      "，构建于 " +
      database.buildEpoch.toISOString() +
      "，节点数 " +
      database.nodeCount +
      "。\n",
  )
}

main().catch((error: unknown) => {
  console.error("GeoLite2 合并库更新失败", error)
  process.exitCode = 1
})
