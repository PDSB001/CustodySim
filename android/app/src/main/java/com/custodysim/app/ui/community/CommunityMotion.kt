package com.custodysim.app.ui.community

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Refresh
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun CommunityActionIconButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    backgroundColor: Color = Color.Transparent, content: @Composable () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduceMotion = LocalEffects.current.reduceMotion
    val scale by animateFloatAsState(if (enabled && pressed && !reduceMotion) 0.94f else 1f,
        tween(if (reduceMotion) 0 else if (pressed) 80 else 180, easing = FastOutSlowInEasing), label = "community-action-press")
    val color by animateColorAsState(backgroundColor, tween(if (reduceMotion) 0 else 180), label = "community-action-color")
    Button(onClick, modifier.graphicsLayer { scaleX = scale; scaleY = scale }, enabled = enabled,
        minWidth = 44.dp, minHeight = 44.dp, cornerRadius = 16.dp, insideMargin = PaddingValues(0.dp),
        colors = ButtonDefaults.buttonColors(color = color, disabledColor = color,
            contentColor = MiuixTheme.colorScheme.onSurface,
            disabledContentColor = MiuixTheme.colorScheme.onSurfaceVariantSummary), interactionSource = interaction) { content() }
}

@Composable
internal fun CommunityRefreshButton(loading: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val reduceMotion = LocalEffects.current.reduceMotion
    CommunityActionIconButton(onClick, enabled = enabled,
        modifier = Modifier.semantics { if (loading) stateDescription = "正在刷新" }) {
        Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
            AnimatedContent(loading, contentAlignment = Alignment.Center, transitionSpec = {
                fadeIn(tween(if (reduceMotion) 0 else 160)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 100)) using null
            }, label = "community-refresh") { refreshing ->
                if (refreshing) CircularProgressIndicator(size = 22.dp, strokeWidth = 2.5.dp)
                else Icon(MiuixIcons.Refresh, "刷新", Modifier.size(24.dp), tint = MiuixTheme.colorScheme.onSurface)
            }
        }
    }
}

/** A fixed progress slot avoids pushing the article/list on every refresh. */
@Composable
internal fun CommunityReadStatus(loading: Boolean, error: String?, onRetry: () -> Unit) {
    val reduceMotion = LocalEffects.current.reduceMotion
    var retainedError by remember { mutableStateOf(error) }
    SideEffect { if (error != null) retainedError = error }
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().padding(horizontal = AppSpace.page).height(3.dp)) {
            androidx.compose.animation.AnimatedVisibility(loading,
                enter = fadeIn(tween(if (reduceMotion) 0 else 180)), exit = fadeOut(tween(if (reduceMotion) 0 else 150))) {
                LinearProgressIndicator(height = 2.dp)
            }
        }
        AnimatedVisibility(error != null,
            enter = fadeIn(tween(if (reduceMotion) 0 else 160)) + expandVertically(tween(if (reduceMotion) 0 else 220), clip = false),
            exit = fadeOut(tween(if (reduceMotion) 0 else 120)) + shrinkVertically(tween(if (reduceMotion) 0 else 180), clip = false)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = AppSpace.page).padding(top = AppSpace.small, bottom = AppSpace.tiny),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                Text(error ?: retainedError.orEmpty(), Modifier.weight(1f), style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.error)
                TextButton("重试", onClick = onRetry, enabled = !loading, minHeight = 40.dp,
                    insideMargin = PaddingValues(horizontal = 12.dp, vertical = 8.dp), textStyle = MiuixTheme.textStyles.footnote1)
            }
        }
    }
}
