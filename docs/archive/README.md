# 历史设计与验证索引

整理日期：2026-10-18。历史记录用于解释方案来源与当时证据，当前操作统一从[文档中心](../README.md)进入。审查材料集中在 [reviews](../reviews/README.md)，原报告未按新结论重写。Web、Android 与维护记录分别按子目录归档。

| 记录                                                            | 性质                                  |
| --------------------------------------------------------------- | ------------------------------------- |
| [Web 性能](web/web-performance.md)                              | 2026-09 性能实施与验证快照            |
| [Web UI 收尾](web/web-ui-review-2026-10-02.md)                  | 2026-10-02 页面核验                   |
| [Web 图书馆设计](web/library-web-design.md)                     | 当时 UI、计时与布局方案               |
| [App 图书馆设计](android/library-app-design.md)                 | 早期原生方案，部分引擎已替换          |
| [旧原生规格与事故](android/android-client-legacy.md)            | 原完整接入说明、R8/OOM 调查与设备记录 |
| [仓库拆分计划](android/android-stabilization-and-repo-split.md) | 独立仓库创建前的方案                  |
| [阅读器翻页](android/android-reader-pagination-refactor.md)     | 迁移阶段的分格式方案                  |
| [Episteme 接入](android/android-episteme-integration.md)        | 上游来源与引擎改造过程                |
| [Android 性能](android/android-performance.md)                  | 旧变体、设备和耗时证据                |
| [Miuix 改造](android/android-ui-refactor.md)                    | UI 改造过程                           |
| [玻璃材质](android/android-glass-pilot.md)                      | 效果与设备边界                        |
| [警告清理](android/android-warning-audit.md)                    | 当时检查结果                          |
| [API 37](android/android-target-api-37.md)                      | 目标 SDK 调整记录                     |

当前仅四种 App 构建类型、独立仓库与原生阅读引擎；历史 android/、.app-workspace/、development、benchmark、H5 不作为当前执行入口。历史中的“尚未部署”“已在本机验证”不反映当前环境状态。

维护记录：[2026-10-18 文档修缮](maintenance/2026-10-18.md)。
