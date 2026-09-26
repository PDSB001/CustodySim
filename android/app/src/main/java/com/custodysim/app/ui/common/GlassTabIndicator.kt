package com.custodysim.app.ui.common

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.custodysim.app.ui.theme.EffectsLevel
import com.custodysim.app.ui.theme.LocalDarkTheme
import com.custodysim.app.ui.theme.LocalEffects
import kotlin.math.roundToInt

/** Decorative selection plate. Miuix owns the tab semantics, hit targets and icons above it. */
@Composable
fun BoxScope.GlassTabIndicator(selectedIndex: Int, count: Int) {
    val effects = LocalEffects.current
    if (effects.effectiveLevel != EffectsLevel.GLASS || count < 1) return
    val position = animateFloatAsState(
        selectedIndex.coerceIn(0, count - 1).toFloat(),
        animationSpec = if (effects.reduceMotion) snap() else spring(dampingRatio = 1f, stiffness = 450f),
        label = "glass-selected-tab",
    )
    val dark = LocalDarkTheme.current
    val fill = animateColorAsState(
        if (dark) Color.Black.copy(alpha = 0.18f) else Color.Black.copy(alpha = 0.06f),
        label = "glass-selected-fill",
    )
    val edge = animateColorAsState(
        if (dark) Color.White.copy(alpha = 0.10f) else Color.White.copy(alpha = 0.30f),
        label = "glass-selected-edge",
    )
    BoxWithConstraints(Modifier.matchParentSize()) {
        val cellWidth = maxWidth / count
        val widthPx = constraints.maxWidth.toFloat() / count
        val shape = RoundedCornerShape(20.dp)
        Box(Modifier
            .offset {
                // offset is relative in RTL; the logical index still follows the Miuix row.
                IntOffset((position.value * widthPx).roundToInt(), 0)
            }
            .width(cellWidth)
            .height(64.dp)
            .padding(horizontal = 4.dp, vertical = 6.dp)
            .graphicsLayer {
                this.shape = shape
                shadowElevation = 6.dp.toPx()
                ambientShadowColor = Color.Black.copy(alpha = if (dark) 0.30f else 0.18f)
                spotShadowColor = ambientShadowColor
                clip = false
            }
            .drawWithCache {
                val outline = shape.createOutline(size, layoutDirection, this)
                onDrawBehind {
                    drawOutline(outline, fill.value)
                    drawOutline(outline, edge.value, style = Stroke(0.75.dp.toPx()))
                }
            })
    }
}
