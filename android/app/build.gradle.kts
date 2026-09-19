import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.custodysim.app"
    // Compose BOM 2026.09 的库要求 compileSdk >= 37（AGP 9.4 支持到 API 37）
    compileSdk = 37

    defaultConfig {
        applicationId = "com.custodysim.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // 服务端地址不入库，按优先级解析：
        //   1. android/local.properties 的 custodysim.baseUrl（本机私有，已在 .gitignore）
        //   2. 环境变量 CUSTODYSIM_BASE_URL（CI 用）
        //   3. gradle.properties 的 custodysim.baseUrl（仓库内只有模拟器占位地址）
        val localPropertiesFile = rootProject.file("local.properties")
        val localBaseUrl = if (localPropertiesFile.exists()) {
            Properties()
                .apply { localPropertiesFile.inputStream().use { load(it) } }
                .getProperty("custodysim.baseUrl")
        } else {
            null
        }
        val baseUrl = listOfNotNull(
            localBaseUrl?.trim()?.takeIf { it.isNotEmpty() },
            providers.environmentVariable("CUSTODYSIM_BASE_URL").orNull?.trim()?.takeIf { it.isNotEmpty() },
            providers.gradleProperty("custodysim.baseUrl").orNull?.trim()?.takeIf { it.isNotEmpty() },
        ).firstOrNull() ?: error(
            "缺少服务端地址：请在 android/local.properties 或 gradle.properties 配置 custodysim.baseUrl",
        )
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    // 内置 Kotlin 下 jvmTarget 默认等于这里的 targetCompatibility，无需再显式设置。
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.miuix.ui.android)
    implementation(libs.miuix.preference.android)
    implementation(libs.miuix.icons.android)
    implementation(libs.navigationevent.compose)

    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
}
