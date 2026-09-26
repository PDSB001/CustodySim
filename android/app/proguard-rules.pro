# Release and benchmark use R8 optimization.
# OkHttp / WorkManager / Room 等依赖都自带 consumer 规则，
# 生效后的完整配置见 app/build/outputs/mapping/<variant>/configuration.txt。

# ---------------------------------------------------------------------------
# Room：生成的 *_Impl 只能被反射创建，必须连无参构造器一起保留
#
# Room 建库走的是：
#     Class.forName("<库类全名>_Impl").getDeclaredConstructor().newInstance()
# 静态代码里不存在 new WorkDatabase_Impl() 这样的调用点，R8 在收缩阶段会把这个
# 构造器当作无用代码删掉；而 androidx.room:room-runtime 的 consumer 规则只有
#
#     -keep class * extends androidx.room.RoomDatabase     ← 没有成员子句
#
# 它只保住类名，保不住成员。于是 WorkManager 在启动初始化 WorkDatabase 时抛：
#     RuntimeException: Failed to create an instance of class ...
# 现象就是开启 R8 后一启动就闪退（InitializationProvider → WorkManagerInitializer）。
#
# 注意必须用 -keep 而不是 -keepclassmembers：类名不能改，Room 是按原类名去查的。
# 通配符同时覆盖 WorkManager 的 WorkDatabase 和以后 App 自己新增的 Room 库。
# ---------------------------------------------------------------------------
-keep class * extends androidx.room.RoomDatabase {
    <init>();
}

# WorkManager persists InputMerger class names and calls a public no-arg constructor.
# Its consumer rule keeps class names but does not retain that reflective constructor.
-keep class * extends androidx.work.InputMerger {
    public <init>();
}
