package com.custodysim.app.ui.theme

import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

enum class EffectsLevel { OFF, SOFT, GLASS }

/** Capability limits are applied before the single system-policy downgrade. */
internal fun resolveEffectsLevel(
    requested: EffectsLevel,
    supportsBlur: Boolean,
    powerSaving: Boolean,
    reduceMotion: Boolean,
    supportsRefraction: Boolean = supportsBlur,
): EffectsLevel {
    val supported = if (requested == EffectsLevel.GLASS && (!supportsBlur || !supportsRefraction)) EffectsLevel.SOFT else requested
    return if (powerSaving || reduceMotion) when (supported) {
        EffectsLevel.GLASS -> EffectsLevel.SOFT
        EffectsLevel.SOFT -> EffectsLevel.OFF
        EffectsLevel.OFF -> EffectsLevel.OFF
    } else supported
}

@Stable
class EffectsState(
    initial: EffectsLevel,
    initialEnabledLevel: EffectsLevel,
    private val save: (EffectsLevel, EffectsLevel) -> Unit,
) {
    var level by mutableStateOf(initial)
        private set
    var enabledLevel by mutableStateOf(initialEnabledLevel.takeUnless { it == EffectsLevel.OFF } ?: EffectsLevel.GLASS)
        private set
    var supportsBlur by mutableStateOf(false)
        internal set
    var supportsRefraction by mutableStateOf(false)
        internal set
    var powerSaving by mutableStateOf(false)
        internal set
    var reduceMotion by mutableStateOf(false)
        internal set
    private val blurOwners = mutableStateListOf<Any>()

    val effectiveLevel: EffectsLevel
        get() = resolveEffectsLevel(level, supportsBlur, powerSaving, reduceMotion, supportsRefraction)
    internal val hasBlurSurfaces: Boolean get() = blurOwners.isNotEmpty()
    val drawLevel: EffectsLevel
        get() = effectiveLevel

    fun setEnabled(enabled: Boolean) = select(if (enabled) enabledLevel else EffectsLevel.OFF)
    fun select(value: EffectsLevel) {
        if (value != EffectsLevel.OFF) enabledLevel = value
        level = value
        save(level, enabledLevel)
    }


    internal fun registerSurface(owner: Any) { if (owner !in blurOwners) blurOwners.add(owner) }
    internal fun unregisterSurface(owner: Any) { blurOwners.remove(owner) }
    internal fun hasBlurSlot(owner: Any): Boolean = blurOwners.indexOf(owner) in 0 until MAX_BLUR_LAYERS

    companion object { const val MAX_BLUR_LAYERS = 2 }
}

val LocalEffects = staticCompositionLocalOf<EffectsState> { error("Missing effects state") }

@Composable
internal fun rememberEffectsState(): EffectsState {
    val context = LocalContext.current
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state = remember(context) {
        val preferences = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
        fun read(key: String, fallback: EffectsLevel) = runCatching {
            EffectsLevel.valueOf(preferences.getString(key, fallback.name)!!)
        }.getOrDefault(fallback)
        EffectsState(read("effects_level", EffectsLevel.OFF), read("effects_enabled_level", EffectsLevel.GLASS)) { level, enabledLevel ->
            preferences.edit {
                putString("effects_level", level.name)
                putString("effects_enabled_level", enabledLevel.name)
            }
        }
    }
    DisposableEffect(context, view, lifecycle, state) {
        val resolver = context.contentResolver
        fun refreshPolicy() {
            state.supportsBlur = Build.VERSION.SDK_INT >= 31 && view.isHardwareAccelerated &&
                !context.getSystemService(ActivityManager::class.java).isLowRamDevice
            state.supportsRefraction = state.supportsBlur && Build.VERSION.SDK_INT >= 33
            state.powerSaving = context.getSystemService(PowerManager::class.java).isPowerSaveMode
            // Android's "Remove animations" accessibility switch sets these global scales to 0.
            state.reduceMotion = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f ||
                Settings.Global.getFloat(resolver, Settings.Global.TRANSITION_ANIMATION_SCALE, 1f) == 0f
        }
        val refresh = Runnable { refreshPolicy() }
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) = refreshPolicy()
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) = refreshPolicy()
        }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshPolicy()
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.TRANSITION_ANIMATION_SCALE), false, observer)
        ContextCompat.registerReceiver(context, receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        lifecycle.addObserver(lifecycleObserver)
        refreshPolicy()
        view.post(refresh)
        onDispose {
            view.removeCallbacks(refresh)
            lifecycle.removeObserver(lifecycleObserver)
            context.unregisterReceiver(receiver)
            resolver.unregisterContentObserver(observer)
        }
    }
    return state
}

