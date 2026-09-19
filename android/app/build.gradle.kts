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

        // 服务端地址来自 gradle.properties，换环境只改配置不改代码。
        val baseUrl = providers.gradleProperty("custodysim.baseUrl").get()
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
