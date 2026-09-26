# Android 开发与构建

面向构建和调试 App 的开发者。安装后如何登录、打卡、聊天和填写档案，见[使用指南](user-guide.md)；普通用户无需安装 Android Studio。

当前客户端版本 1.5.2-test（versionCode 2），工程位于 `android/`。

## 工具链

Gradle Wrapper 9.8.0、AGP 9.4.1、Kotlin 2.4.0、Compose BOM 2026.09.00、Miuix 0.9.3；compileSdk / targetSdk 37，minSdk 26。通过 SDK Manager 安装 API 37 和构建工具。本机验证使用 JDK 25，Java/Kotlin 字节码目标为 17；IDE Gradle JDK 与终端 JAVA_HOME 应一致。

## 私有地址

以下配置是安装包的初始默认地址。用户现在也可通过登录页或「我的 → 关于应用 → 服务器设置」设置公网 HTTPS 服务器，保存后无需重新打包，见[服务器设置](server-selection.md)。旧安装首次升级会绑定原默认服务器；已经保存的选择不随后续 APK 默认值改变。

在 `android/local.properties` 保留 SDK 路径，填写下列占位地址的实际值：

```properties
custodysim.baseUrl=http://10.0.2.2:3000
custodysim.realtimeUrl=http://10.0.2.2:3001
custodysim.productionBaseUrl=https://example.com
custodysim.productionRealtimeUrl=wss://example.com
```

10.0.2.2 仅适用于模拟器，真机使用开发机局域网 IP。优先级为 local.properties → 环境变量；对应环境变量为 `CUSTODYSIM_BASE_URL`、`CUSTODYSIM_REALTIME_URL`、`CUSTODYSIM_PRODUCTION_BASE_URL`、`CUSTODYSIM_PRODUCTION_REALTIME_URL`。生产实时地址可省略，按 HTTPS 地址推导 WSS。

公开 debug/release 不读取任何预置地址，缺少私有地址配置也能构建。production、development 和 benchmark 只在构建对应变体时校验配置。私有地址按字节混淆后写入 APK，不保存明文 URL 常量；这不是加密保密，运行时仍能被提取或通过网络观察，不能用于隐藏秘密。local.properties、构建目录与 APK 不入库。

## 构建与检查

以下 PowerShell 命令在 `android/` 下运行；Linux/macOS 改用 `./gradlew`：

```powershell
.\gradlew.bat :app:assembleDevelopment
.\gradlew.bat :app:assembleBenchmark :app:testDebugUnitTest :app:lintDebug
```

| 变体        | 用途            | 默认地址 / 签名                                     |
| ----------- | --------------- | --------------------------------------------------- |
| release     | GitHub 公开发布 | 无地址，首次使用设置服务器；需另行正式签名          |
| debug       | 公开包调试      | 无地址，debug 签名                                  |
| production  | 本机生产使用    | 混淆的生产 HTTPS/WSS 地址，R8 优化，本机 debug 签名 |
| development | 本地联调        | 私有开发地址，debug 签名，独立应用 ID `.dev`        |
| benchmark   | 联调性能验证    | 与 development 同地址和应用 ID，R8 优化，debug 签名 |

```powershell
# 公开产物，禁止上传 production/development/benchmark 包
.\gradlew.bat :app:assembleRelease
# 本机生产使用
.\gradlew.bat :app:assembleProduction
# 本地联调，可和生产 App 并存
.\gradlew.bat :app:assembleDevelopment
```

APK 位于 `app/build/outputs/apk/<变体>/`。生产安装命令为 `adb install -r app/build/outputs/apk/production/app-production.apk`。联调安装命令为 `adb install -r app/build/outputs/apk/development/app-development.apk`。production 的 debug 签名用于本机覆盖现有测试包，不能当作正式发布签名；签名不兼容时不要直接卸载丢失数据。

已有安装保留原服务器选择与会话，不因切换 APK 默认值而静默迁移；生产预置值用于首次安装，旧用户通过服务器设置切换。development / benchmark 新应用 ID 使用独立数据，首次需重新登录。公开包覆盖旧安装也保留用户已选服务器，“无预置”不等于清除用户配置。

构建缓存、配置缓存、并行构建均启用，日常不要先 clean，见[缓存说明](android-build-cache.md)。首次下载依赖需联网，`--offline` 仅适合依赖已缓存时。

## 运行验证

API 37 联调包访问识别出的内网地址时显示局域网授权入口；私有 DNS 域名需加 `custodysim.localNetwork=true`。公开 debug/release 和本机 production 不增加此权限，见[适配记录](android-target-api-37.md)。

升级后核对登录/MFA、图片聊天/撤回、照片选择/裁剪、弹层/键盘、档案签名/导出及前后台定位/通知。打卡 GPS 与后台上传是独立开关；5/10 分钟后台周期依赖应用可见时启动的前台服务，不承诺 Doze 下精确定时。

2026-09-26 的 API 37 构建与 40 项单元测试通过，尚未完成 Android 17 真机回归。性能数据见[历史记录](android-performance.md)，接口与能力边界见[接入文档](android-client.md)。
