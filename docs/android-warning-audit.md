# Android 警告清理（2026-09-26）

> 历史实施与验证记录。版本、测试数量及设备表现按记录当时理解；当前操作入口见 [文档目录](README.md)。

扫描范围：app 全部 main/debug/benchmark/test/androidTest 源码与资源、Gradle 配置；main Kotlin 文件 67 个。结合 Android Lint、Kotlin 编译和 IDE 截图核对，未设置全局警告禁用或 Lint baseline。

## 已处理

- AppContainer 文档链接失效、Context 平台类型；PendingPoint.toJson 显式非空返回类型。
- 无调用的 AuthRepository.changePassword/trustedDevice、CheckinRepository.fetchMakeups 及其专用模型、常量；实际调用的 TokenStore.trustedDevice 保留。
- ChatRealtimeClient 移除无挂起操作的 suspend，delay 改为 Duration。
- DraftStore 未使用异常参数及 nullable when 分支。
- 定位缓存读取显式处理 SecurityException，保持权限撤销时返回空结果。
- 图片方向读取迁至 AndroidX ExifInterface 1.4.2（[官方发布说明](https://developer.android.com/jetpack/androidx/releases/exifinterface)）。
- 清理未使用 import、11 个未使用字符串、可用 KTX 替代、Long Compose 状态装箱及可疑缩进。
- Android Studio 本地项目词典补充 checkin、okhttp、acks 等领域词。

## 有意保留的兼容逻辑

- KeystoreCipher 的 ANDROID_ID 用于旧 s: 密文解密；更改派生方式会使已有凭证无法解密。仅该方法豁免 HardwareIds，并注明用途，不上传该 ID。
- 当前 AAPT 实测移除 mipmap-anydpi-v26 后无法链接 ic_launcher，已恢复；lint.xml 只豁免该目录的 ObsoleteSdkInt。
- Debug 网络配置需要访问本地 HTTP；仅 Debug XML 标记 InsecureBaseConfiguration。正式包仍要求 HTTPS。

## 验证与剩余提示

后续更新：targetSdk 已升级 37，Debug Lint 的 OldTargetApi 已消除；当前工具链与适配边界见 [API 37 记录](android-target-api-37.md)。以下是升级前本次清理的验证快照。

- Debug / benchmark Lint 成功，无 error。Debug 剩余 13 项均为版本建议（7 GradleDependency、5 NewerVersionAvailable、1 OldTargetApi）。benchmark 报告剩余依赖版本、targetSdk 与联调 HTTP 配置提示。
- 单元测试共 40 项通过；主代码、本地测试和真机测试源码编译通过；优化包构建通过。最后补充返回类型之后再次完成三类源码编译。
- 保留现有 targetSdk 36 和其余固定依赖版本，未将目标 SDK 或整套依赖升级混入清理。
- Android Studio 专属检查无法由 Gradle 完全复现，因此不承诺 IDE 的全部提示数量归零；截图中有明确文件位置的项目已逐项处理。
