# Android 开发入口

核对日期：2026-10-18。Android 已在[独立 CustodySim-app 仓库](https://github.com/PDSB001/CustodySim-app)维护，当前日常目录为同级 CustodySim-app。不要在 Web 仓库创建 android/，旧 .app-workspace/ 操作仅为历史工作方式。

## 当前指南

| 事项                             | 权威文档                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| 工具链、四个变体、私有端点、构建 | [App 开发与发布](https://github.com/PDSB001/CustodySim-app/blob/main/docs/android-development.md) |
| CI 与产物                        | [App CI](https://github.com/PDSB001/CustodySim-app/blob/main/docs/ci.md)                          |
| 正文下载、磁盘缓存与原生引擎     | [App 阅读与缓存](https://github.com/PDSB001/CustodySim-app/blob/main/docs/reader-cache.md)        |
| Android 14+ 前台定位与权限       | [App 权限说明](https://github.com/PDSB001/CustodySim-app/blob/main/docs/permissions.md)           |
| 许可与对应源码                   | [发布许可](https://github.com/PDSB001/CustodySim-app/blob/main/README-LICENSE.md)                 |
| 服务端协议                       | [原生接口规格](android-client.md)                                                                 |

## 快速核对

在独立 App 仓库根执行：

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:lintDebug
```

仅 debug、debugR8、production、release；EPUB/DOCX 使用 Episteme，TXT/PDF 使用各自原生引擎，无 WebView 回退。production/release/debugR8 均开启 R8；正式 APK 由维护者本机签名，并生成同一版本对应源码。构建不等于真实设备验收。

当前版本 1.6.1-test、versionCode 4；版本、SDK、依赖与输出路径以独立仓库构建文件为准。本文仅作为跨仓入口，避免复制完整构建流程造成两份说明漂移。
