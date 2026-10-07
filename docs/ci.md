# 持续集成

Web/API 与 Android 分别在各自仓库运行 GitHub Actions。PR、主分支推送和手动
`Run workflow` 都会触发检查。流水线只负责验证和保留构建产物；正式 APK 由维护者
在本机签名构建。Actions 不需要添加任何私有密钥、服务地址或生产环境配置。

## Web/API

入口：`.github/workflows/ci.yml`，主分支 `master`。

| Job | 检查内容 |
| --- | --- |
| Lint, types and unit tests | ESLint、TypeScript、全部 Vitest 单元测试、缓存清理守卫与实时服务断库重连回归、部署脚本的隔离模拟测试 |
| Database and browser regression | 临时 PostgreSQL 18；初始化独立测试库；积分与业务 API 测试；桌面/移动浏览器与积分页面回归 |
| Next.js build | 按锁文件安装依赖，执行 Next.js 构建 |
| Web CI gate | 所有上游 Job 成功才通过；失败、取消或跳过都不会放行 |

Node 版本集中在 `.node-version`，pnpm 版本来自 `package.json` 的 `packageManager`。
依赖安装统一使用 `--frozen-lockfile`，缓存键随锁文件变化。
测试数据库和测试用密钥都是当前 runner 的一次性公开测试配置，不访问真实服务。
业务、积分和普通浏览器测试严格限定 `custodysim_e2e`，与 `custodysim_ci` 分开。
显式配置 `E2E_DATABASE_URL` 时，初始化和测试都使用该连接；其他数据库名称会被拒绝。
业务 API 测试和浏览器测试顺序执行，避免同时改写测试数据。
浏览器测试在 Next 启动前执行缓存清理守卫；检测到开发端口占用时跳过清理。

失败时展开失败步骤查看日志；浏览器 trace 保留在 `web-test-results-*` artifact 中，
保存 7 天。构建成功只说明代码能生成产物，仍需根据改动验收实际功能。

建议在 GitHub 分支规则中将 **Web CI gate** 设为必需检查。不要用路径过滤跳过
整份 workflow，否则必需检查可能一直处于等待状态。

## Android

独立仓库 `CustodySim-app` 的入口是 `.github/workflows/ci.yml`，主分支 `main`。
日常源码仍在主项目的 `.app-workspace` 独立 Git worktree 中；这里的 workflow
需要提交到 App 仓库，不能提交进 Web 仓库。

Android CI 使用 JDK 17、仓库 Gradle wrapper 与 API 37。检查包括：

- Gradle wrapper 校验与缓存；PR 只能读取主分支缓存。
- Episteme `UPSTREAM.json` 中每个文件的 SHA-256 校验。
- Debug 单元测试、Lint、Debug 与未签名 Release 构建。
- 对应源码归档完整性与私有文件排除检查。

Lint 保持 warnings-as-errors，仅排除依赖更新提醒和 Timber 的日志风格提醒。
依赖升级由维护者单独审查，不让新版本发布时间改变同一提交的检查结果。

产物 `android-build-<commit SHA>` 包含 Debug APK、未签名 Release APK、
同次构建的对应源码、`COMMIT.txt` 和 `SHA256SUMS`，保留 14 天。
测试/Lint 报告保留 7 天。未签名 APK 用于构建验证，正式分发包由维护者自行
构建并签名，且应从同一提交生成对应源码，随 APK 一起提供。

建议将 **Android CI gate** 设为 App 主分支必需检查。CI 不验证真机手势、
阅读帧率或正式包签名连续性，这些由本机发布流程验收。

## 维护规则

两份 workflow 都只申请 `contents: read`，不读取仓库 Secrets。
第三方 Action 固定到提交 SHA，由 Dependabot 每周提出版本更新 PR。
同分支检查按队列运行，后续检查不会自动取消正在运行的检查；每个 Job 都有限时。
主分支不要提交本机 `.env.local`、`local.properties`、签名文件或私有测试截图。

新增数据库变更时，补充隔离库回归；新增 Android 上游源文件时，通过 vendor
脚本更新 `UPSTREAM.json`，避免 CI 校验与实际代码分离。调整工具版本时，同步
验证锁文件和 wrapper，不在 workflow 中另装一套浮动版本。
