# Gradle 与构建缓存

2026-09-26：Wrapper 从 9.7.1 升级至稳定版 9.8.0，同步更新 gradlew、gradlew.bat 和 wrapper JAR。AGP 9.4.1 保持不变。

`android/gradle.properties`：

```properties
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.configuration-cache=true
org.gradle.configuration-cache.problems=fail
```

- Build cache 原本已启用，缓存可复用的任务输出；日志用 `FROM-CACHE` 表示恢复输出。
- 新启用 configuration cache，保存配置阶段的任务图；日志用 `Configuration cache entry reused` 表示复用。保持严格模式，不将不兼容问题降级成警告。
- 缓存位于本机 Gradle 用户目录及 `android/.gradle`，不进入 Git。没有配置或上传远端缓存。
- 修改构建脚本、依赖或配置输入后，Gradle 会重新计算必要内容；修改私有服务地址后必须重新构建 APK。
- 日常构建使用 `./gradlew :app:assembleBenchmark`，无需每次 `clean`。排障时可临时加 `--no-configuration-cache` 或 `--no-build-cache`。

验证环境：Windows、JDK 25；任务为 `:app:assembleBenchmark :app:testDebugUnitTest --offline --warning-mode all`。首次升级构建成功，用时 67 秒、2 项任务 FROM-CACHE；原样重跑用时 1 秒，76 项 UP-TO-DATE，configuration cache 已复用。40 项单元测试通过。时间只代表该机器、该任务集的无修改重跑，不是一般增量编译保证。

插件配置阶段仍有 `Configuration.setVisible(boolean)` 弃用提示；本次未关闭警告输出。Gradle 升级本身不代表 AGP、目标 SDK 和所有业务依赖同时升级。

官方资料：[Gradle 发布列表](https://gradle.org/releases/)、[配置缓存](https://docs.gradle.org/current/userguide/configuration_cache_enabling.html)。
