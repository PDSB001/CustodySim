package com.custodysim.app.ui.theme

import android.app.Activity
import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.background
import androidx.compose.runtime.*
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.core.content.edit
import top.yukonga.miuix.kmp.theme.*

enum class Appearance { SYSTEM, LIGHT, DARK }

class AppearanceState(initial: Appearance, private val save: (Appearance) -> Unit) {
    var mode by mutableStateOf(initial)
        private set
    fun select(value: Appearance) { mode = value; save(value) }
}

val LocalAppearance = staticCompositionLocalOf<AppearanceState> { error("Missing appearance") }
val LocalDarkTheme = staticCompositionLocalOf { false }

/** Shared layout rhythm. MIUIX owns control shapes, pressed feedback and motion. */
object AppSpace {
    val tiny = 4.dp
    val small = 8.dp
    val medium = 12.dp
    val page = 16.dp
    val inset = 20.dp
    val section = 24.dp
    val large = 32.dp
    val contentWidth = 720.dp
}

object AppShape {
    val control = 16.dp
    val group = 24.dp
    val sheet = 32.dp
    val thumbnail = 12.dp
}

object AppColors {
    val success: Color @Composable get() = if (LocalDarkTheme.current) Color(0xFF79D69C) else Color(0xFF18733B)
    val warning: Color @Composable get() = if (LocalDarkTheme.current) Color(0xFFFFCA80) else Color(0xFF925300)
}

private val LightColors = lightColorScheme(
    primary = Color(0xFF3478F6), surface = Color(0xFFF6F7FA), background = Color.White,
    onSurfaceVariantSummary = Color(0xFF666870), onBackgroundVariant = Color(0xFF707789),
    error = Color(0xFFBC342B),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF82AEFF), onPrimary = Color(0xFF09254D),
    surface = Color(0xFF101113), background = Color(0xFF202125),
    surfaceVariant = Color(0xFF202125), surfaceContainer = Color(0xFF202125),
    onSurfaceVariantSummary = Color(0xFFB2B3BC), onBackgroundVariant = Color(0xFFA1A6B8),
    error = Color(0xFFFF938A),
)
private val AppTypography = defaultTextStyles(
    title1 = TextStyle(fontSize = 34.sp, lineHeight = 42.sp, fontWeight = FontWeight.Medium),
    title2 = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.Medium),
    body1 = TextStyle(fontSize = 17.sp, lineHeight = 25.sp),
    footnote1 = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
    footnote2 = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
    button = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium),
)

/**
 * MiuiX（小米 HyperOS 风格）主题壳。
 *
 * `ColorSchemeMode.System` 表示跟随系统深浅色；MiuiX 的组件都从 `MiuixTheme` 取色，
 * 因此界面里不要再自己写死颜色。
 */
@Composable
fun CustodySimTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val appearance = remember {
        val preferences = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
        AppearanceState(
            runCatching { Appearance.valueOf(preferences.getString("mode", "SYSTEM")!!) }
                .getOrDefault(Appearance.SYSTEM),
        ) { preferences.edit { putString("mode", it.name) } }
    }
    val dark = when (appearance.mode) {
        Appearance.SYSTEM -> isSystemInDarkTheme()
        Appearance.LIGHT -> false
        Appearance.DARK -> true
    }
    val controller = remember(dark) {
        ThemeController(if (dark) ColorSchemeMode.Dark else ColorSchemeMode.Light,
            lightColors = LightColors, darkColors = DarkColors)
    }
    val view = LocalView.current
    SideEffect {
        (view.context as? Activity)?.window?.let { window ->
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    CompositionLocalProvider(LocalAppearance provides appearance, LocalDarkTheme provides dark) {
        Crossfade(targetState = dark, animationSpec = tween(260), label = "theme-transition") {
            MiuixTheme(controller = controller, textStyles = AppTypography) {
                Box(Modifier.fillMaxSize().background(MiuixTheme.colorScheme.surface)) { content() }
            }
        }
    }
}
