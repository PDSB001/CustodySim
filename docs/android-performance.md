# Android 真机性能复测

> 历史实施与验证记录。版本、测试数量及设备表现按记录当时理解；当前操作入口见 [文档目录](README.md)。

## 构建

在 `android` 目录运行 `gradlew.bat :app:assembleBenchmark`。
输出为 `app/build/outputs/apk/benchmark/app-benchmark.apk`。

`benchmark` 使用 R8 优化，关闭 debuggable，用本机 debug 密钥签名。
它用于本地性能验收，不是正式发布包；包名与开发版相同。签名一致时可覆盖安装，
若签名不一致，不要通过卸载来解决，以免丢失本地数据。
生产 release 的签名配置没有改动。服务地址仍按原有本地配置读取。

## 测量方法

1. 使用同一设备、刷新率和系统动画设置，分别记录首次启动和使用一段时间后的表现。
2. 清零统计：`adb shell dumpsys gfxinfo com.custodysim.app reset`。
3. 手动重复固定流程：切换首页、任务、我的，再打开并关闭同一个弹层。不要提交数据。
4. 读取统计：`adb shell dumpsys gfxinfo com.custodysim.app`。
5. 对比帧数、P50/P95/P99 和 GPU 分位耗时；不要只比较 Janky frames 百分比。

不要把长时间混合操作、静置的样本当作某个动画的 FPS。
不要用强制全量 AOT 编译或先运行几分钟后的结果替代首次启动结果。

## 2026-09-25 初步记录

修改前设备安装的是 DEBUGGABLE / TEST_ONLY 包。
一次累计 5204 帧的统计为 P50 10ms、P95 32ms、P99 77ms，GPU P95 为 6ms。
这是混合操作的历史样本，不能据此确认单个函数是瓶颈。
后续重置后仅收到 30 帧，不足以作为完整操作流程的对照。

本轮减少了整页透明度合成、尺寸动画、卡片 shader 离屏绘制，
将主题颜色读取移到 draw 阶段、缩略图布局固定，并将启动网络初始化及令牌加解密移到 IO 线程。
依赖自带的 ART profiles 由构建合并；尚未录制本应用业务路径的 Baseline Profile。
新版尚需安装后复测，不能把编译成功当作帧率提升的证据。

## 2026-09-25 长列表与弹层调整

- 实际解析的 Foundation 为 1.12.1。使用 `LazyLayoutCacheWindow`，任务、聊天、通知、
  申请、点名及动态表单向前预组合 0.5 屏、向后保留 0.25 屏；没有强制开启内部实验开关。
  档案查看的单项包含多张图片和完整字段，本轮只补稳定 key/contentType，不扩大其缓存。
- 任务分页根据可见项接近末尾触发，预组合加载尾项不会请求下一页。
  切换分类、刷新、取消请求后恢复加载状态；重复页没有新增记录时停止翻页。
- 删除任务/点名项恒为 true 的 AnimatedVisibility 包装，保留页面切换动画。
- 私聊与档案表单在 show=false 时保留内容，避免退场期间切为空状态而改变高度。
  私聊弹层补齐内容内边距，公共弹层消费导航栏安全区；撤销私聊关闭的 700ms 延时。
- Miuix Snackbar 用于打卡、补卡、填报、申请提交反馈和聊天发送失败。
  表单校验和整页加载失败继续在原处显示。

本轮验证：compileDebugKotlin、现有 testDebugUnitTest 通过（9 项）。
未采集新版本的真机帧耗时，也未录制业务 Baseline Profile，缓存比例仍需真机校准。
复测时用相同数据分别记录首次快速下滑、反向滚动、翻页中切换分类，以及快速打开/关闭私聊；
同时比较 P95/P99 和内存，避免用增大缓存换取持续增长的内存占用。

## 2026-10-05 阅读器 DOCX / EPUB 连翻

在开发构建（`com.custodysim.app.dev`）上手动执行固定流程：DOCX 文档从第 10 屏连续翻阅到第 30 屏，
EPUB 使用包含跨节的场景。统计前已重置对应计数。

| 样本 | 帧数 | Janky | P50 / P95 / P99 | GPU P95 | 观察 |
| --- | --- | --- | --- | --- | --- |
| DOCX 连翻第 10–30 屏 | 1040 | 1（0.10%） | 9 / 13 / 15 ms | 5 ms | 连续滚动时正文移动正常，未见空白或冻屏 |
| EPUB（含跨节） | 638 | 28（4.39%） | 8 / 14 / 17 ms | 5 ms | Slow UI thread 21 次、Slow issue draw commands 15 次 |

原始 `dumpsys gfxinfo` 转储保留在 `artifacts/reader-docx-verified-frames.txt` 与
`artifacts/reader-epub-verified-frames.txt`。

本轮不作为性能验收通过：

- EPUB 含跨节场景为 4.39%，高于重构方案中“稳定连翻窗口帧超期率低于 1%”的目标。
- DOCX 的 0.10% 只覆盖 20 屏连翻，样本小于人工流程要求的连续快翻至少 100 页。
- 统计取自开发构建，不是 `benchmark` 变体；且只比较 Janky frames 占比，
  没有记录“触摸到首次视觉变化”“目标页就绪”“跨节等待”和内存峰值。
  跨节与节内是否已走同一吸附路径，仍不能由本轮数据判断。

复测仍按本页“测量方法”执行：换 `benchmark` 包，补 P95/P99、最差帧、内存对照，
并把跨节单独报告。阅读器相关方案与门槛见 [阅读器分格式翻页重构](android-reader-pagination-refactor.md)。
