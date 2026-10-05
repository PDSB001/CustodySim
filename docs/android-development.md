# Android 开发与发布

App 独立仓库：https://github.com/PDSB001/CustodySim-app 。
日常联调在主项目目录的 `.app-workspace/` 内进行，这是 App 仓库的独立 Git worktree，
不属于 Web／服务端仓库。主仓库不再维护 `android/`。

## 构建变体

| 变体 | 用途 | 应用 ID | 签名 |
| --- | --- | --- | --- |
| debug | 日常联调 | com.custodysim.app.dev | 本机 debug 签名 |
| debugR8 | 联调、R8 与资源收缩 | com.custodysim.app.dev | 本机 debug 签名 |
| production | 预置远端服务器、R8 与资源收缩 | com.custodysim.app | 发布流程提供；默认未签名 |
| release | 无预置地址、R8 与资源收缩 | com.custodysim.app | 发布流程提供；默认未签名 |

四个变体的阅读路径一致：EPUB/DOCX 使用 Episteme，TXT 使用 StaticLayout 原生引擎，
PDF 使用 PdfRenderer。旧 H5/WebView 阅读器与切换开关已移除。

在 App worktree 根目录执行：

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:assembleDebugR8
.\gradlew.bat :app:assembleProduction
.\gradlew.bat :app:assembleRelease
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:compileDebugAndroidTestKotlin
.\gradlew.bat androidCorrespondingSource
```

在主项目根目录执行时，使用 `.\.app-workspace\gradlew.bat -p .app-workspace`。
服务端也可在 App 设置中配置。可选预置地址只存于忽略的 local.properties 或环境变量：
`custodysim.baseUrl` / `CUSTODYSIM_BASE_URL`、`custodysim.realtimeUrl` /
`CUSTODYSIM_REALTIME_URL`，production 对应 productionBaseUrl、productionRealtimeUrl
与 CUSTODYSIM_PRODUCTION_BASE_URL、CUSTODYSIM_PRODUCTION_REALTIME_URL。
production 的预置地址应使用 HTTPS/WSS；release 始终不嵌入地址。未配置地址也能构建，配置不随 Git 或源码包发布。

APK 输出到 `app/build/outputs/apk/debug/` 、`debugR8/`、`production/` 或 `release/`。
对手机使用 `adb install -r` 覆盖安装，避免卸载或清空数据；签名不兼容需另行处理。
debug 关闭 R8；debugR8 开启 R8，两者使用相同联调预置和包名，可互相覆盖安装。
debug 沿用此前 development 的 `.dev` 包名和本机 debug 签名。

## 发布同步

先在 `.app-workspace` 提交 App 改动，主仓库的 Web/API 改动独立提交。
从主项目目录执行 `scripts/sync-app-release.ps1 -CheckOnly` 检查可同步性，再执行
`scripts/sync-app-release.ps1`，将 App 提交 fast-forward 到 `../CustodySim-app` 的 main，
并在那里构建 release 和 production、运行单元测试与生成对应源码包。默认不会推送远程；明确发布
需要再加 `-Push`。脚本不覆盖未提交改动，不用文件复制抹掉历史，不提交私有配置。
源码包与签名后的 APK 应对应同一版本，遵循 App 的 AGPL 分发要求。

当前 production/release/debugR8 R8 对 Jsoup 1.22.1 的两种可选 re2j 类使用精确 dontwarn 规则；应用使用
JDK 正则路径。上游确认：https://github.com/jhy/jsoup/issues/2459 。
旧性能脚手架和历史变体记录仅作为历史材料，不代表当前可运行流程。