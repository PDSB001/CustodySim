# 仓库目录与文件归属

整理日期：2026-10-18。源码、当前指南、历史记录和本地产物按用途放置，新增文件按以下位置归类。

## Web / API

```text
CustodySim/
├─ app/                 页面、布局、HTTP API
├─ components/          Web UI
├─ lib/                 权限、业务、数据库、单元测试
├─ public/              公开静态文件
├─ deploy/              Nginx 片段与 EdgeOne 函数
├─ scripts/             构建、运维、数据库与验证工具
├─ e2e/                 浏览器和数据库集成测试
├─ docs/
│  ├─ README.md         当前文档入口
│  ├─ assets/           可提交的图解和演示截图
│  ├─ reviews/          原审查、复验、已修和剩余问题
│  └─ archive/          历史材料
│     ├─ android/       迁移前 App 方案与设备记录
│     ├─ web/           旧 Web 设计与性能记录
│     └─ maintenance/   按日期保存的维护记录
└─ artifacts/           本地临时输出，不进入 Git
```

根目录保留框架与工具发现所需的配置：Next、TypeScript、ESLint、Prettier、Playwright、Vitest、Drizzle、pnpm、PM2，以及 proxy/instrumentation。部署和实时服务入口仍在原位置，避免改变运行与调用路径。

[脚本导航](../scripts/README.md)列出用途和风险；开发命令见[开发指南](development.md)，生产入口见[部署指南](deployment.md)。

原根目录三个 CODE-REVIEW 报告已集中到 [reviews/2026-10-17](reviews/2026-10-17/README.md)，原文保留。MFA 运维工具改为 scripts/reset-mfa.mjs，仍只允许开发/测试库，默认只读且写操作要求明确确认数据库；没有放宽保护。

## Android 独立仓库

```text
CustodySim-app/
├─ app/                 Android 应用
├─ episteme-core/       已导入的原生阅读核心
├─ gradle/              wrapper 与版本目录
├─ scripts/             来源、归档和 workflow 校验
├─ docs/
│  ├─ README.md         当前指南
│  ├─ assets/           构建与缓存图解
│  └─ archive/          历史设计、设备与迁移记录
└─ LICENSES/            许可声明
```

Gradle 配置、wrapper、许可、README 与 AGENTS 保留根目录。上游源码不因整理改写，导入清单与哈希仍由 vendor 流程维护。

## 本地输出与旧工作树

本机 artifacts 的散落输出已分为 logs、evidence、reports、snapshots；迁移备份、独立 Git 克隆、上游检查目录与旧工作树保留，文件未删除。分类说明与移动清单仅保存在忽略的 artifacts 内。

本地 .next、node_modules、Gradle 构建与依赖缓存继续保留，避免不必要重构建。旧 App 工作树存在未提交改动，不能把它当作可直接删除的缓存。

需要回收磁盘时，先用 `pnpm clean` 只读查看，再按[脚本导航](../scripts/README.md)选择范围；目录归档本身不减少文件数据量。

## 后续放置规则

- 当前操作说明放 docs，历史设计与验证放 docs/archive 的对应分类。
- 新审查放 docs/reviews/YYYY-MM-DD，并区分原报告、复验、修复与剩余事项。
- 可公开配图放 docs/assets；真实设备、业务诊断截图和原始日志留在忽略的 artifacts。
- 运行脚本放 scripts；已经被包脚本、部署或 CI 引用的入口不为美化目录随意改名。
- 不在 Git 中提交 .env.local、local.properties、签名、APK、依赖、备份或缓存。
