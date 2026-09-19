// 根构建脚本：只声明插件，不在这里配置任何模块。
//
// AGP 9 起内置 Kotlin 支持（默认开启），因此**不再声明** org.jetbrains.kotlin.android。
//
// 但内置的 KGP 版本是 2.2.10，而 MiuiX 0.9.3 的元数据由 Kotlin 2.4.0 编译，
// 低版本编译器会报 "Module was compiled with an incompatible version of Kotlin"。
// AGP 官方给出的抬高方式就是在顶层构建脚本里显式声明 KGP 的 classpath。
buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.0")
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
