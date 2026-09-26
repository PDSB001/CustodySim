# Android 17 / API 37

2026-09-26：targetSdk 从 36 升至 37；compileSdk 保持 37，minSdk 保持 26。

## 兼容处理

- Android 17 的局域网权限仅声明在 debug / benchmark 清单中。公网生产 release 不声明、不请求该权限。
- 联调地址为私有 IPv4、IPv6 ULA/link-local、`.local` 或单段主机名时，在恢复会话前显示授权入口；拒绝后可以跳转应用设置。旧系统不进入该流程。
- 使用解析到局域网 IP 的普通域名时，在本机 `android/local.properties` 设置 `custodysim.localNetwork=true`。构建配置不进行 DNS 查询，私有地址不写入仓库。
- 检索应用源码未发现 MessageQueue 私有字段反射、修改 static final、动态加载本地代码或 RemoteViews 自定义布局。没有锁定方向/禁止调整窗口尺寸的清单配置。
- 保持系统 TLS 校验和 Android 17 默认 CT 策略，不为新 target 关闭安全检查。

## 验证范围

运行 `:app:assembleBenchmark :app:lintDebug :app:testDebugUnitTest` 验证编译、静态检查与现有业务单元测试。构建检查不能代替 Android 17 真机运行验证；仍需在 API 37 设备验证登录/实时聊天、前后台定位、照片选择、弹层返回与大屏窗口调整，以及局域网授权拒绝/允许分支。

## 官方依据

- [Android 17 发布](https://android-developers.googleblog.com/2026/06/Android-17.html)
- [面向 Android 17 的行为变更](https://developer.android.com/about/versions/17/behavior-changes-17)
- [影响所有应用的行为变更](https://developer.android.com/about/versions/17/behavior-changes-all)
