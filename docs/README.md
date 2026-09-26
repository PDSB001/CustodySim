# 文档目录

维护日期：2026-09-26。日常操作优先阅读指南；历史记录中的版本、测试数量和设备表现保留当时语境。

## 使用者与业务管理人员

| 你想了解什么                           | 从这里开始                     |
| -------------------------------------- | ------------------------------ |
| 第一次登录、每天怎么用                 | [使用指南](user-guide.md)      |
| 打卡、任务、申请、档案与聊天的具体操作 | [使用指南](user-guide.md)      |
| 看不懂状态、提交失败、定位与图片问题   | [常见问题](faq.md)             |
| 如何配置业务、批阅任务和跟进申请       | [管理人员指南](staff-guide.md) |

这些文档按界面操作编写，不要求使用者了解数据库、API 或命令行。Web 与 App 不完全等同，使用指南列出了两端入口。

## 开发与技术维护人员

- [项目概览](../README.md)
- [开发与测试](development.md)：本地初始化、双进程启动、检查命令、测试隔离。
- [配置参考](configuration.md)：环境变量、密钥、代理与可选服务。
- [生产部署](deployment.md)：首次与增量部署、两份脚本区别、Nginx 和故障排查。
- [Android 开发指南](android-development.md)：工具链、私有地址、构建变体与运行验证。
- [Android 接口与行为](android-client.md)：鉴权、定位、图片与聊天协议。

## 专题

- [App 服务器设置](server-selection.md)：用户操作、匿名检测协议和会话隔离。

- [安全邮箱与腾讯云 SES](security-email.md)
- [自动任务审核](automatic-task-review.md)
- [数据库性能升级](database-web-performance-upgrade.md)
- [Gradle 与构建缓存](android-build-cache.md)
- [Android API 37 适配](android-target-api-37.md)
- [积分 E2E](../e2e/scoring/README.md)、[业务 E2E](../e2e/business/README.md)

## 历史实施与验证记录

- [Web 性能](web-performance.md)
- [Android 性能复测](android-performance.md)
- [Miuix 界面改造](android-ui-refactor.md)
- [玻璃材质试点与迭代](android-glass-pilot.md)
- [Android 警告清理](android-warning-audit.md)

## 维护规则

变更配置需同步 `.env.example` 和配置参考；变更部署流程需同步部署指南；变更原生协议需同步接口文档；变更 SDK 需同步 Android 开发指南。验证结果注明日期、环境和未验证项，不把“构建成功”写成“生产可用”。示例使用占位域名，不复制私有配置。
