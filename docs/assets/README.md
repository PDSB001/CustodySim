# 文档配图

制作日期：2026-10-18。SVG 为本项目绘制的可编辑结构示意，不含外部素材。

| 文件                       | 用途                                             |
| -------------------------- | ------------------------------------------------ |
| system-overview.png        | 架构图的 PNG 预览，内容同 SVG                    |
| system-overview.svg        | 双端、CDN、代理、进程和数据库                    |
| document-map.svg           | 按角色阅读导航                                   |
| deployment-flow.svg        | 增量部署阶段                                     |
| ci-pipeline.svg            | 双仓独立验证流水线                               |
| cache-flow.svg             | 当前鉴权与缓存关系                               |
| reader-troubleshooting.svg | 阅读排障顺序                                     |
| android-builds.svg         | 四个构建类型与发布边界                           |
| web-login.png              | 本地 Web 登录页面                                |
| web-library.png            | 演示管理员的空书架管理界面                       |
| web-auto-review.png        | 自动审核配置，外部密钥与开关均未启用             |
| web-mobile-home.png        | 演示被监管账号的手机 Web 首页；不是原生 App 截图 |

截图使用 2026-10-18 的本地开发服务与 custodysim_e2e 演示数据，非生产账号或业务记录。桌面视口 1440×1000，手机 Web 390×844。截图不含凭据、浏览器地址栏或服务端配置。

布局变化后应在同样隔离条件重新拍摄，不能拼接假数据冒充运行结果。App 仓库只复用原生构建与缓存 SVG，不使用手机 Web 图冒充原生 UI。
