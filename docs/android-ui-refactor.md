# Android MIUIX 界面重构记录

> 历史实施与验证记录。版本、测试数量及设备表现按记录当时理解；当前操作入口见 [文档目录](README.md)。

## 范围与分析

项目实际目录为 `android/`，单 `:app` 模块、单 Activity、纯 Jetpack Compose。
现有版本：AGP 9.4.1、Gradle 9.6.0、Kotlin 2.4.0、Compose BOM 2026.09.00、MIUIX 0.9.3；compileSdk 37 / targetSdk 36 / minSdk 26。本次没有升级这些版本。

导航原本由 `AppRoot` 负责会话切换，`AppShell` 负责首页、点名、任务、我的四个入口，没有 Fragment、Navigation 图或深链接。界面直接通过协程调用现有 Repository，没有独立 ViewModel。

原有界面已经使用 MIUIX，但缺少统一状态展示、可选择主题、资源文案和可适配长内容的布局；`LoadState` 仍导入 Material Text，登录页和表单缺少完整的输入避让处理。

## 页面清单

“代码完成”不等于已经完成真机视觉验收。

| 页面 / 状态  | 改造                                                       | 验证                         |
| ------------ | ---------------------------------------------------------- | ---------------------------- |
| 会话恢复     | MIUIX 加载组件、安全区域                                   | 编译通过                     |
| 登录         | 品牌标题、分组输入、IME、键盘动作、错误提示、忙碌状态      | 编译通过，等待截图           |
| 二次验证     | 验证器 / 恢复码、设备信任开关、返回登录、触觉反馈          | 编译通过，等待截图           |
| 首页         | 定位授权摘要、策略与权限分组、单次上报忙碌反馈             | 调试包真机启动并查看首页截图 |
| 点名         | 分组懒加载列表、状态标签、操作入口、空态 / 加载 / 失败重试 | 编译通过，等待截图           |
| 打卡表单     | 可滚动弹层、备注、照片替换 / 移除、提交锁定                | 编译通过，等待截图           |
| 补卡表单     | 必填原因、照片、统一错误与提交状态                         | 编译通过，等待截图           |
| 任务         | 分组懒加载列表、状态 / 截止时间 / 批阅 / 评分、失败重试    | 编译通过，等待截图           |
| 动态任务表单 | 文本、数字键盘、单选、图片、说明字段、必填检查、附件上限   | 编译通过，等待截图           |
| 我的         | 账号分组、主题选择、版本信息                               | 编译通过，等待截图           |
| 退出确认     | MIUIX Dialog、取消 / 确认、退出全部设备说明                | 编译通过，等待截图           |

原项目不存在单独的设置 Activity、详情页、搜索页、菜单、FAB、Slider、Snackbar；没有为了凑组件而新增无关页面。

## 公共设计系统

- `ui/theme/Theme.kt`：沿用 MIUIX 主题与组件动画，集中定义浅深色背景、表面、正文、次级文字、主色、错误、成功和警告色；统一 Typography、AppSpace、AppShape。
- 外观提供跟随系统 / 浅色 / 深色，选择保存到专用 SharedPreferences；状态栏与导航栏图标随实际主题同步。
- `ui/common/Components.kt`：SettingGroup、GroupedListItem、SectionTitle、InfoRow、NoticeBanner、PageState、PrimaryAction。
- MIUIX 原生组件继续负责 AppBar、NavigationBar、Button、TextField、Switch、RadioButton、进度指示、Dialog、BottomSheet。移除直接 Material3 依赖及最后一处 Material Text 导入。
- 自定义部分仅为业务分组、上下排列的信息行、状态标签、状态提示和图片缩略图。颜色不再散落于业务页面。
- 最大内容宽度 720dp，内容可滚动；长值放在标签下方；图片横向滚动；系统栏、刘海、IME 使用 Insets。弹层数据保留到关闭动画结束。
- 标准 Compose BackHandler 为现有 Activity 版本提供弹层 / 根页面返回行为；保留原 MIUIX NavigationEvent owner。预测返回手势动画尚未真机验证。

## 保留的功能与边界

保留账号登录、MFA、信任设备、会话恢复 / 失效处理、原有退出接口；保留位置策略查询、权限申请、即时上报、后台调度与队列；保留点名、补卡、动态任务提交、图片压缩 / 选择、批阅与评分展示。

Repository、API、数据模型、Keystore、网络层、服务端、定位采集与后台调度实现均未重写。附加改动限定在 UI：避免重复提交、表单必填提示、附件数量约束、Android 11+ 后台权限引导至系统应用设置。上述业务流程仍需有效测试账号进行完整端到端回归，不能仅凭编译与单元测试宣称全部验证完成。

## 构建与测试

Windows 使用本机 JDK 17、现有 Android SDK 与 Gradle 缓存。

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --console=plain
```

- 基线 assembleDebug：通过。
- 设计系统、导航 / 登录、首页改造后的阶段性 compileDebugKotlin：通过。
- 最终 assembleDebug：通过，APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。
- 最终 testDebugUnitTest：9 项全部通过（ImagePipeline 4 项、Gcj02 5 项）。
- lintDebug：失败，剩余 **1 error / 11 warnings**。本次新增的资源访问错误已修复。
- 唯一剩余 error：未改动的 `app/src/main/java/com/custodysim/app/location/LocationCollector.kt:72`，`lastKnown()` 中 `getLastKnownLocation()` 的 `MissingPermission`。该方法已有 runCatching，调用者检查前台权限，但 Lint 未识别跨方法检查。本次不以全局 suppress 或 baseline 隐藏，也不扩大 UI 改造到定位业务实现。
- 其余 warnings 包括原有依赖版本、EXIF、设备标识、调试明文网络、资源目录等；没有升级依赖以消除版本提示。
- 调试 APK 已在连接的 Redmi K70 Ultra 上安装并成功启动；启动时 AndroidRuntime 错误日志未见崩溃。

## 尚未完成的验收

设备拒绝 ADB 点击注入（INJECT_EVENTS），用户选择发送截图进行后续核对。因此尚未完成点名 / 任务 / 登录 / MFA / 我的 / Dialog / Sheet 的逐页真机验收，以及深色、小屏、横屏、大字体、键盘弹出、手势返回和完整业务提交回归。

后续截图以实际页面为准，不把参考图或编译结果当作运行验证。当前交付是代码改造与可构建 APK，视觉验收仍待继续。

## 19:06 用户截图复查

已收到点名、任务两张真机截图。截图可确认这两个列表已正常渲染，状态栏 / 底部导航可见；不能据静态截图确认滚动到底、表单、深色或提交行为。

发现任务状态 `EXPIRED` 尚未翻译，以及刷新按钮和每条记录的全宽操作按钮过于突出。本轮修正：

- 对照现有服务端与 Web 客户端，补齐任务已逾期 / 通过 / 未通过 / 取消，以及点名、补卡审批状态的资源文案和语义色。补卡申请的 PENDING 单独显示“待审批”，不再复用“待打卡”。
- 使用 ListHeader 把刷新收为分组标题右侧的轻量操作，保留加载禁用与失败重试。
- 使用 RecordContent 将可操作记录的按钮放在右侧；内容宽度不足 300dp 或 fontScale 大于 1.3 时移到内容下方，保留长文本换行空间。
- 任务入口文案从状态名称“待提交”改为动作“填写汇报”。现有可操作状态判断与提交接口保持不变。

本轮 assembleDebug 已通过。更新需后续新截图复查，旧截图不代表修正后的显示效果。

## 19:15 用户截图复查

截图进一步暴露了三个视觉问题：页面切换和列表出现几乎没有动效；蓝色主色只出现在少数选中态和文字上；底部打卡弹层的“关闭”、图片移除和次级操作都呈现为过大的灰色块。

本轮修正：

- `AppShell` 的四个主页面使用 `AnimatedContent`，带淡入和横向位移动效；点名与任务列表项使用错峰淡入 / 上移，分组内容变化使用 `animateContentSize`。
- 可执行的“打卡 / 补卡申请 / 填写汇报”改为 MIUIX 主色按钮；图片添加、重新选择、弹层关闭使用主色或主色弱底；状态标签继续使用统一语义色，主题色覆盖操作链路而不是只覆盖导航。
- 弹层关闭从大号文字按钮改为带无障碍描述的紧凑关闭图标；图片移除改为缩略图右上角的图标按钮，不再在图片下方占用一整行；图片预览扩大到 112dp 并保持横向滚动。

本轮 `assembleDebug` 与 9 项既有单元测试通过。由于设备在安装前断开，尚未取得本轮修正后的真机截图。
