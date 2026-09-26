package com.custodysim.app.ui.common

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.custodysim.app.ui.theme.*
import com.kyant.backdrop.backdrops.LayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.highlight.HighlightStyle
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import androidx.compose.ui.unit.DpOffset
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Only the page is captured. Never include chrome or popup hosts in this source. */
@Stable
class GlassBackdrop internal constructor(internal val layer: LayerBackdrop) {
    internal var size by mutableStateOf(IntSize.Zero)
}

val LocalGlassBackdrop = staticCompositionLocalOf<GlassBackdrop?> { null }
val LocalGlassPageBottomInset = compositionLocalOf { 0.dp }
val LocalGlassPageTopInset = compositionLocalOf { 0.dp }

@Composable
fun rememberGlassBackdrop(): GlassBackdrop {
    // Scaffold uses surface for the page; background is the contrasting card color.
    // Recording card white here would brighten empty areas behind the translucent header.
    val background = rememberUpdatedState(MiuixTheme.colorScheme.surface)
    val layer = rememberLayerBackdrop {
        drawRect(background.value)
        drawContent()
    }
    return remember(layer) { GlassBackdrop(layer) }
}

@Composable
fun Modifier.glassBackdropSource(backdrop: GlassBackdrop): Modifier {
    val effects = LocalEffects.current
    return onSizeChanged { backdrop.size = it }.then(
        if (effects.effectiveLevel != EffectsLevel.OFF && effects.supportsBlur &&
            !effects.powerSaving && !effects.reduceMotion && effects.hasBlurSurfaces)
            // Isolate the source from Scaffold chrome: recording it must not invalidate
            // the shared parent display list that also draws the consuming glass layer.
            Modifier.graphicsLayer().layerBackdrop(backdrop.layer) else Modifier,
    )
}

@Composable
fun glassPagePadding(top: Dp = AppSpace.page, bottom: Dp = AppSpace.page): PaddingValues = PaddingValues(
    start = AppSpace.page, end = AppSpace.page, top = top + LocalGlassPageTopInset.current,
    bottom = bottom + LocalGlassPageBottomInset.current,
)

/** Backdrop affects the small surface only; Miuix content stays sharp and interactive. */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = AppShape.group,
    enableRefraction: Boolean = true,
    content: @Composable BoxScope.() -> Unit,
) {
    val effects = LocalEffects.current
    val backdrop = LocalGlassBackdrop.current
    val owner = remember { Any() }
    var surfaceSize by remember { mutableStateOf(IntSize.Zero) }
    val dark = LocalDarkTheme.current
    val tint = animateColorAsState(MiuixTheme.colorScheme.surface, tween(260), label = "glass-tint")
    val shape = remember(cornerRadius) { RoundedCornerShape(cornerRadius) }
    DisposableEffect(effects, owner) {
        effects.registerSurface(owner)
        onDispose { effects.unregisterSurface(owner) }
    }
    val sourceArea = backdrop?.size?.let { it.width.toLong() * it.height } ?: 0L
    val level = effects.effectiveLevel
    val canSample = level != EffectsLevel.OFF && effects.supportsBlur && !effects.powerSaving &&
        !effects.reduceMotion && backdrop != null && effects.hasBlurSlot(owner) &&
        sourceArea > 0 && surfaceSize.width.toLong() * surfaceSize.height <= sourceArea * 0.35f
    // SOFT is the previous frosted appearance. GLASS uses Backdrop's actual lens shader.
    // Flat title bars intentionally stay frosted for text legibility.
    val liquid = level == EffectsLevel.GLASS && effects.supportsRefraction && enableRefraction
    val material = if (canSample) {
        Modifier.drawBackdrop(
            backdrop = backdrop.layer,
            shape = { shape },
            effects = {
                // The flat header must preserve the page's neutral color at rest.
                if (enableRefraction) vibrancy()
                blur((if (liquid) 4.dp else 12.dp).toPx())
                if (liquid) {
                    lens(refractionHeight = 16.dp.toPx(), refractionAmount = 32.dp.toPx(), depthEffect = true)
                }
            },
            highlight = if (liquid) ({ Highlight(width = 1.dp, blurRadius = 0.5.dp,
                style = HighlightStyle.Default(color = Color.White.copy(alpha = if (dark) 0.7f else 0.85f))) }) else null,
            shadow = if (liquid) ({ Shadow(radius = 8.dp, color = Color.Black.copy(alpha = 0.08f)) }) else null,
            innerShadow = if (liquid) ({ InnerShadow(radius = 3.dp, offset = DpOffset(0.dp, 1.dp),
                color = Color.Black.copy(alpha = if (dark) 0.12f else 0.06f)) }) else null,
            onDrawSurface = {
                val alpha = if (liquid) { if (dark) 0.30f else 0.20f }
                    else if (enableRefraction) { if (dark) 0.55f else 0.32f }
                    else { if (dark) 0.75f else 0.65f }
                drawRect(tint.value.copy(alpha = alpha))
            },
        )
    } else {
        Modifier.drawWithCache {
            val outline = shape.createOutline(size, layoutDirection, this)
            onDrawBehind {
                if (level == EffectsLevel.OFF) drawRect(tint.value)
                else {
                    drawOutline(outline, tint.value.copy(alpha = 0.94f))
                    if (enableRefraction) {
                        drawOutline(outline, Color.White.copy(alpha = if (dark) 0.2f else 0.7f),
                            style = Stroke(1.dp.toPx()))
                    }
                }
            }
        }
    }
    // Keep the composable subtree stable when preferences or system policy change.
    Box(modifier.onSizeChanged { surfaceSize = it }.then(material), content = content)
}
