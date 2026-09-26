import java.util.Properties
import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// 本机私有配置（android/local.properties，不入库）：服务端地址从这里取，真实域名不写进仓库。
val localPropertiesFile = rootProject.file("local.properties")
val localProperties = Properties().apply {
    if (localPropertiesFile.exists()) localPropertiesFile.inputStream().use { load(it) }
}

// Private defaults never come from tracked gradle.properties.
fun serverUrl(propertyKey: String, environmentKey: String): String =
    localProperties.getProperty(propertyKey)?.trim()?.takeIf { it.isNotEmpty() }
        ?: providers.environmentVariable(environmentKey).orNull?.trim().orEmpty()
val devBaseUrl = serverUrl("custodysim.baseUrl", "CUSTODYSIM_BASE_URL")
val devRealtimeUrl = serverUrl("custodysim.realtimeUrl", "CUSTODYSIM_REALTIME_URL")
val productionBaseUrl = serverUrl("custodysim.productionBaseUrl", "CUSTODYSIM_PRODUCTION_BASE_URL")
val productionRealtimeUrl = serverUrl("custodysim.productionRealtimeUrl", "CUSTODYSIM_PRODUCTION_REALTIME_URL")
    .ifEmpty { productionBaseUrl.replaceFirst("https://", "wss://") }
// Obfuscation only: runtime endpoints remain recoverable.
fun encodedUrl(value: String): String = value.toByteArray(Charsets.UTF_8).mapIndexed { index, byte ->
    ((byte.toInt() and 255) xor ((index * 31 + 167) and 255)).toString()
}.joinToString(",")

// No DNS lookup during configuration. Private DNS names can opt in through local.properties.
fun isLocalEndpoint(url: String): Boolean {
    val host = URI(url).host?.lowercase()?.removeSurrounding("[", "]") ?: return false
    val octets = host.split('.').mapNotNull { it.toIntOrNull() }
    return host.endsWith(".local") || (!host.contains('.') && !host.contains(':')) ||
        (octets.size == 4 && (octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 169 && octets[1] == 254))) ||
        (host.contains(':') && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))
}
val needsLocalNetwork = localProperties.getProperty("custodysim.localNetwork")?.toBooleanStrictOrNull()
    ?: (isLocalEndpoint(devBaseUrl) || isLocalEndpoint(devRealtimeUrl))

android {
    namespace = "com.custodysim.app"
    // Compose BOM 2026.09 的库要求 compileSdk >= 37（AGP 9.4 支持到 API 37）
    compileSdk = 37

    defaultConfig {
        applicationId = "com.custodysim.app"
        minSdk = 26
        //noinspection EditedTargetSdkVersion
        targetSdk = 37
        versionCode = 2
        versionName = "1.5.2-test"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "BASE_URL_ENCODED", "\"\"")
        buildConfigField("String", "REALTIME_URL_ENCODED", "\"\"")
        buildConfigField("boolean", "NEEDS_LOCAL_NETWORK", "false")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            buildConfigField("boolean", "NEEDS_LOCAL_NETWORK", "false")
            isMinifyEnabled = true
            // 代码收缩必须配套资源收缩，否则未引用的图标/字符串/布局仍会进包。
            // 资源收缩只认静态引用（R 类、清单、keep.xml）；本项目没有 getIdentifier /
            // getResourceEntryName 这类按名字取资源的写法（含 Miuix 依赖），因此无需额外 keep。
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        create("production") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug") // Local installation; not a publishing key.
            matchingFallbacks += listOf("release")
            buildConfigField("String", "BASE_URL_ENCODED", "\"${encodedUrl(productionBaseUrl)}\"")
            buildConfigField("String", "REALTIME_URL_ENCODED", "\"${encodedUrl(productionRealtimeUrl)}\"")
        }
        create("development") {
            initWith(getByName("debug"))
            signingConfig = signingConfigs.getByName("debug") // Local installation; not a publishing key.
            matchingFallbacks += listOf("debug")
            applicationIdSuffix = ".dev"
            buildConfigField("boolean", "NEEDS_LOCAL_NETWORK", needsLocalNetwork.toString())
            buildConfigField("String", "BASE_URL_ENCODED", "\"${encodedUrl(devBaseUrl)}\"")
            buildConfigField("String", "REALTIME_URL_ENCODED", "\"${encodedUrl(devRealtimeUrl)}\"")
        }
        create("benchmark") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug") // Local installation; not a publishing key.
            matchingFallbacks += listOf("release")
            applicationIdSuffix = ".dev"
            buildConfigField("boolean", "NEEDS_LOCAL_NETWORK", needsLocalNetwork.toString())
            buildConfigField("String", "BASE_URL_ENCODED", "\"${encodedUrl(devBaseUrl)}\"")
            buildConfigField("String", "REALTIME_URL_ENCODED", "\"${encodedUrl(devRealtimeUrl)}\"")
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
    implementation(libs.androidx.lifecycle.runtime.compose)
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
    implementation(libs.backdrop.android)
    implementation(libs.androidsvg)
    implementation(libs.androidx.exifinterface)
    implementation(libs.navigationevent.compose)

    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.okhttp)

    // 两个独立测试源码集均使用 JUnit，不能互相替代。
    testImplementation(libs.junit)
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
}

// A public build requires no private settings. Check only requested private variants.
val productionConfigured = productionBaseUrl.startsWith("https://") && productionRealtimeUrl.startsWith("wss://")
val developmentConfigured = devBaseUrl.isNotBlank() && devRealtimeUrl.isNotBlank()
tasks.matching { it.name == "preProductionBuild" }.configureEach {
    val configured = productionConfigured
    doFirst { check(configured) { "production requires private HTTPS and WSS server settings" } }
}
tasks.matching { it.name == "preDevelopmentBuild" || it.name == "preBenchmarkBuild" }.configureEach {
    val configured = developmentConfigured
    doFirst { check(configured) { "development requires private baseUrl and realtimeUrl settings" } }
}
