# CustodySim

面向组织管理、任务办理与协作的 Web/API 系统，配套独立 Android 客户端。支持点名与补卡、任务和申请审核、档案签名、通知、聊天、图书阅读、积分与匿名社区。

![CustodySim 系统组成与访问链路](docs/assets/system-overview.svg)

> 文档核对日期：2026-10-18。Web 版本 **1.5.2-test**；Android 版本 **1.6.1-test（versionCode 4）**。两端分别发布，版本号不要求相同。

## 从这里开始

| 你的角色          | 建议阅读                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日常使用者        | [使用指南](docs/user-guide.md) · [常见问题](docs/faq.md)                                                                                                 |
| 监管人员 / 管理员 | [管理人员指南](docs/staff-guide.md) · [自动审核](docs/automatic-task-review.md)                                                                          |
| 开发者            | [开发与测试](docs/development.md) · [系统架构](docs/architecture.md) · [CI](docs/ci.md)                                                                  |
| 运维人员          | [生产部署](docs/deployment.md) · [配置参考](docs/configuration.md) · [运维排障](docs/operations.md)                                                      |
| Android 维护者    | [独立 App 仓库](https://github.com/PDSB001/CustodySim-app) · [构建指南](https://github.com/PDSB001/CustodySim-app/blob/main/docs/android-development.md) |

完整专题、图解及审查记录见[文档中心](docs/README.md)；文件归属见[目录说明](docs/repository-layout.md)，维护工具见[脚本导航](scripts/README.md)。

## 能做什么

| 业务       | 主要能力                                              |
| ---------- | ----------------------------------------------------- |
| 日常办理   | 时段打卡、补卡申请、任务表单、逐级申请、通知确认      |
| 审核与档案 | 任务与补卡集中审核、原因与轨迹、档案会签、签名与导出  |
| 学习与激励 | PDF / EPUB / DOCX / TXT、有效阅读计时、学习任务、积分 |
| 协作与管理 | 组织和监管范围、聊天图片、匿名社区、自愿档案分享      |

操作权限由服务端的角色、组织及监管关系校验。界面显示某个入口不等于获得该资源权限。

## 本地启动

推荐使用仓库 [.node-version](.node-version) 指定的 **Node 26.12.1** 与 package.json 锁定的 **pnpm 12.14.0**。package.json 要求 Node >=26，已对齐 PDF.js 和测试工具的实际要求；部署前也应核对 Node 版本。

```bash
pnpm install --frozen-lockfile
```

将 [.env.example](.env.example) 复制为 .env.local，填入独立开发数据库和每用途独立的随机密钥。已有文件不要覆盖；占位密钥不能运行。

```bash
# 仅限新开发库：核对连接目标后同步结构
pnpm db:push
pnpm dev
```

另开终端运行 `pnpm dev:realtime`。Web 默认 3000，聊天实时服务默认 3001。管理员初始化、手机联调和独立测试库见[开发指南](docs/development.md)。

## 仓库与技术边界

- 本仓库维护 Next.js 16.4.2、React 19.3.1、TypeScript、PostgreSQL/Drizzle、Socket.IO 实时服务。
- Android 在独立的 [CustodySim-app](https://github.com/PDSB001/CustodySim-app) 仓库维护；当前工作目录为同级 CustodySim-app。旧 android/ 和 .app-workspace/ 路径只在历史材料中保留。
- Web / 服务端使用根目录 [MIT 许可](LICENSE)；Android 组合应用按 AGPL-3.0-only 分发，见[许可与对应源码说明](https://github.com/PDSB001/CustodySim-app/blob/main/README-LICENSE.md)。
- CI 负责检查和构建；正式 APK 由维护者本机签名。生产发布按[部署指南](docs/deployment.md)执行。

## 维护约定

版本与命令以构建文件为依据；修改功能同时更新对应指南。凭据、签名、备份、真实用户截图不入库。集成测试只使用 custodysim_e2e，不能指向业务库。历史验证结果只证明记录时的环境，不能替代当前生产或真机验收。
