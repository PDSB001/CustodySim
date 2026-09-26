# CustodySim

CustodySim 包含 Web 管理与业务端、Android 客户端和独立聊天实时服务，支持组织与人员管理、点名打卡、任务表单、申请审批、档案签名与图片导出、通知、聊天和位置上报。

当前版本：**1.5.2-test**。操作权限由服务端角色与组织范围控制。

## 选择适合你的文档

**如果你是使用者**，不需要搭建服务器：使用管理员提供的网址或安装包，按[使用指南](docs/user-guide.md)登录并办理事项。遇到问题先看[常见问题](docs/faq.md)。

**如果你是监管人员或管理员**，按[管理人员指南](docs/staff-guide.md)安排和审核业务。管理员账号与服务器维护是两种职责，业务操作不要求执行部署命令。

**如果你负责开发或运维**，从下表进入技术指南。部署服务后，请把使用指南和正确的访问入口交给用户，而不是要求用户照着构建命令操作。

## 技术人员入口

| 需要做什么                       | 文档                                            |
| -------------------------------- | ----------------------------------------------- |
| 本地启动 Web 和聊天服务          | [开发与测试](docs/development.md)               |
| 首次部署、增量更新、Nginx 与排障 | [生产部署](docs/deployment.md)                  |
| 数据库、密钥、实时服务与可选能力 | [配置参考](docs/configuration.md)               |
| 构建、安装和联调 Android         | [Android 开发指南](docs/android-development.md) |
| 原生鉴权、定位、图片和聊天协议   | [Android 接口与行为](docs/android-client.md)    |
| 专题说明和历史验证记录           | [文档目录](docs/README.md)                      |

## 技术组成

| 模块           | 当前配置                                                 | 入口                    |
| -------------- | -------------------------------------------------------- | ----------------------- |
| Web / HTTP API | Next.js 16.3.3、React 19、TypeScript                     | app/、components/、lib/ |
| 数据库         | PostgreSQL、Drizzle ORM、node-postgres                   | lib/db/schema.ts        |
| 聊天实时服务   | Socket.IO，独立 Node 进程                                | realtime-server.mjs     |
| Android        | Kotlin 2.4.0、Compose、Miuix 0.9.3                       | android/                |
| Android 构建   | Gradle 9.8.0、AGP 9.4.1；min 26 / compile 37 / target 37 | android/gradle/         |

## 本地开发快速启动

准备 Node.js（项目声明最低 20.9.0）、pnpm 12.4.2 和独立开发 PostgreSQL 数据库后：

```bash
pnpm install --frozen-lockfile
```

将 [.env.example](.env.example) 复制为 `.env.local`，填写自己的数据库连接和独立随机密钥；默认密钥占位符不可直接运行。然后：

```bash
pnpm db:push
pnpm dev
```

另开终端执行 `pnpm dev:realtime`，Web 默认使用 3000，实时服务使用 3001。管理员初始化、实时地址和测试库配置见[开发指南](docs/development.md)。生产环境按[部署指南](docs/deployment.md)操作。

## 维护约定

- package.json 和 Android 构建文件是版本、命令和依赖的依据，文档与对应代码一起更新。
- .env.local、android/local.properties、凭据、签名密钥及数据库备份不提交仓库。
- 集成测试和 E2E 会写数据库，必须使用独立测试库。
- 历史截图与测试结果只代表记录时的版本，不代表当前生产已部署或所有设备已验证。
