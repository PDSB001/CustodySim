package com.custodysim.app.ui.community

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import com.custodysim.app.AppContainer
import com.custodysim.app.data.media.decodeDataUrlBitmap
import com.custodysim.app.ui.common.RemoteImageState
import com.custodysim.app.ui.common.rememberRemoteImageState
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Close
import top.yukonga.miuix.kmp.icon.extended.Photos
import top.yukonga.miuix.kmp.theme.MiuixTheme
import kotlin.math.max
import kotlin.math.min

/** Keep the image payload mounted until the dialog's exit animation has finished. */
@Composable
internal fun CommunityImageViewer(
    container: AppContainer,
    urls: List<String>,
    initialIndex: Int,
    visible: Boolean,
    onDismiss: () -> Unit,
    onDismissFinished: () -> Unit,
) {
    if (urls.isEmpty()) return
    val reduceMotion = LocalEffects.current.reduceMotion
    val entrance = remember { Animatable(0f) }
    val finishDismiss by rememberUpdatedState(onDismissFinished)
    LaunchedEffect(visible, reduceMotion) {
        val target = if (visible) 1f else 0f
        if (reduceMotion) entrance.snapTo(target)
        else entrance.animateTo(target, tween(if (visible) 220 else 180, easing = FastOutSlowInEasing))
        if (!visible) finishDismiss()
    }

    Dialog(
        onDismissRequest = { if (visible) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // Compose owns the scrim and timing, including Back. A separate window dim would
        // appear/disappear immediately, defeating the retained-payload exit transition.
        val dialogView = LocalView.current
        DisposableEffect(dialogView) {
            (dialogView.parent as? DialogWindowProvider)?.window?.let { window ->
                window.setDimAmount(0f)
                window.setWindowAnimations(0)
                WindowCompat.getInsetsController(window, dialogView).apply {
                    isAppearanceLightStatusBars = false
                    isAppearanceLightNavigationBars = false
                }
            }
            onDispose { }
        }
        val pager = rememberPagerState(initialPage = initialIndex.coerceIn(urls.indices)) { urls.size }
        var zoomedPage by remember { mutableIntStateOf(-1) }
        var showControls by remember { mutableStateOf(true) }
        val duration = if (reduceMotion) 0 else 160
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.matchParentSize().graphicsLayer { alpha = entrance.value }.background(Color.Black))
            HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxSize().graphicsLayer {
                    alpha = entrance.value
                    val scale = 0.96f + entrance.value * 0.04f
                    scaleX = scale; scaleY = scale
                },
                userScrollEnabled = visible && zoomedPage != pager.currentPage,
                key = { it },
            ) { index ->
                CommunityViewerPage(
                    container = container, url = urls[index], index = index, count = urls.size,
                    current = index == pager.currentPage, active = visible && index == pager.currentPage, reduceMotion = reduceMotion,
                    onZoomChanged = { zoomed ->
                        if (zoomed) zoomedPage = index else if (zoomedPage == index) zoomedPage = -1
                    },
                    onTap = { showControls = !showControls },
                )
            }
            AnimatedVisibility(
                visible = showControls && visible,
                modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(AppSpace.page),
                enter = fadeIn(tween(duration)) + slideInVertically(tween(duration)) { -it / 4 },
                exit = fadeOut(tween(duration)) + slideOutVertically(tween(duration)) { -it / 4 },
            ) {
                IconButton(
                    onClick = onDismiss, enabled = visible,
                    backgroundColor = Color.White.copy(alpha = 0.14f),
                    modifier = Modifier.graphicsLayer { alpha = entrance.value },
                    minWidth = 44.dp, minHeight = 44.dp,
                ) {
                    Icon(MiuixIcons.Close, "关闭图片预览", Modifier.size(22.dp), tint = Color.White)
                }
            }
            AnimatedVisibility(
                visible = showControls && visible,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(AppSpace.page),
                enter = fadeIn(tween(duration)) + slideInVertically(tween(duration)) { it / 4 },
                exit = fadeOut(tween(duration)) + slideOutVertically(tween(duration)) { it / 4 },
            ) {
                Row(
                    Modifier.graphicsLayer { alpha = entrance.value }
                        .background(Color.White.copy(alpha = 0.12f), RoundedCornerShape(20.dp))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    AnimatedContent(
                        targetState = pager.currentPage + 1,
                        contentAlignment = Alignment.Center,
                        transitionSpec = {
                            (fadeIn(tween(duration)) + slideInVertically(tween(duration)) { it / 3 }) togetherWith
                                (fadeOut(tween(duration)) + slideOutVertically(tween(duration)) { -it / 3 }) using null
                        }, label = "community-image-counter",
                    ) { page ->
                        Text("$page / ${urls.size}", color = Color.White, style = MiuixTheme.textStyles.footnote1)
                    }
                    Box(Modifier.width(1.dp).height(12.dp).background(Color.White.copy(alpha = 0.22f)))
                    Text(
                        if (zoomedPage == pager.currentPage) "双击还原" else "双击放大",
                        color = Color.White.copy(alpha = 0.70f), style = MiuixTheme.textStyles.footnote2,
                    )
                }
            }
        }
    }
}

@Composable
private fun CommunityViewerPage(
    container: AppContainer, url: String, index: Int, count: Int, current: Boolean, active: Boolean, reduceMotion: Boolean,
    onZoomChanged: (Boolean) -> Unit, onTap: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var attempt by remember(url) { mutableIntStateOf(0) }
    val image = key(url, attempt) { rememberViewerImage(container, url) }
    val bitmap = image.bitmap
    var zoom by remember(url) { mutableFloatStateOf(1f) }
    var pan by remember(url) { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var zoomAnimation by remember { mutableStateOf<Job?>(null) }
    val zoomChanged by rememberUpdatedState(onZoomChanged)
    val tapped by rememberUpdatedState(onTap)
    val reveal = remember(url, bitmap) { Animatable(0f) }
    LaunchedEffect(bitmap, reduceMotion) {
        if (bitmap != null) {
            if (reduceMotion) reveal.snapTo(1f)
            else reveal.animateTo(1f, tween(180, easing = FastOutSlowInEasing))
        }
    }
    fun constrain(offset: Offset, scale: Float): Offset = boundedImagePan(offset, scale, bitmap, viewport)
    LaunchedEffect(current) {
        if (!current) {
            zoomAnimation?.cancel()
            zoom = 1f; pan = Offset.Zero
            zoomChanged(false)
        }
    }
    LaunchedEffect(active) { if (!active) zoomAnimation?.cancel() }
    LaunchedEffect(viewport, bitmap) { pan = constrain(pan, zoom) }
    val transform = rememberTransformableState { centroid, zoomChange, panChange, _ ->
        zoomAnimation?.cancel()
        val next = (zoom * zoomChange).coerceIn(1f, 4f)
        val center = Offset(viewport.width / 2f, viewport.height / 2f)
        val focal = if (centroid.x.isFinite() && centroid.y.isFinite()) centroid else center
        pan = if (next == 1f) Offset.Zero else
            constrain(pan + panChange + (focal - center - pan) * (1f - next / zoom), next)
        zoom = next
        zoomChanged(next > 1.001f)
    }
    Box(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(top = 56.dp, bottom = 64.dp)
            .clipToBounds().onSizeChanged { viewport = it }
            .transformable(transform, canPan = { zoom > 1.001f }, lockRotationOnZoomPan = true, enabled = active && bitmap != null)
            .pointerInput(url, bitmap, active, reduceMotion) {
                if (active && bitmap != null) detectTapGestures(
                    onTap = { tapped() },
                    onDoubleTap = { point ->
                        zoomAnimation?.cancel()
                        val start = zoom
                        val target = if (start > 1.001f) 1f else 2.5f
                        val startPan = pan
                        val center = Offset(viewport.width / 2f, viewport.height / 2f)
                        val targetPan = if (target == 1f) Offset.Zero else
                            constrain(startPan + (point - center - startPan) * (1f - target / start), target)
                        // Disable paging from the start of a zoom, not after the first frame.
                        zoomChanged(true)
                        zoomAnimation = scope.launch {
                            if (reduceMotion) { zoom = target; pan = targetPan }
                            else animate(start, target, animationSpec = tween(240, easing = FastOutSlowInEasing)) { value, _ ->
                                val fraction = (value - start) / (target - start)
                                zoom = value
                                pan = constrain(startPan + (targetPan - startPan) * fraction, value)
                            }
                            zoomChanged(target > 1.001f)
                        }
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) Image(
            bitmap, "图片 ${index + 1} / $count",
            Modifier.matchParentSize().graphicsLayer {
                alpha = reveal.value
                val revealScale = 0.985f + reveal.value * 0.015f
                scaleX = zoom * revealScale; scaleY = zoom * revealScale
                translationX = pan.x; translationY = pan.y
            }, contentScale = ContentScale.Fit,
        )
        // Preserve the outgoing loading state while it fades; never flash the error
        // UI between a successful decode and the image reveal.
        val status = when { bitmap != null -> "ready"; image.loading -> "loading"; else -> "error" }
        AnimatedContent(
            targetState = status,
            contentAlignment = Alignment.Center,
            transitionSpec = { fadeIn(tween(if (reduceMotion) 0 else 140)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 120)) using null },
            label = "community-image-state",
        ) { state ->
            when (state) {
                "loading" -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(
                        size = 28.dp, strokeWidth = 2.5.dp,
                        colors = ProgressIndicatorDefaults.progressIndicatorColors(foregroundColor = Color.White, backgroundColor = Color.White.copy(alpha = 0.18f)),
                    )
                    Text("正在加载图片", color = Color.White.copy(alpha = 0.65f), style = MiuixTheme.textStyles.footnote2)
                }
                "error" -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(MiuixIcons.Photos, null, Modifier.size(32.dp), tint = Color.White.copy(alpha = 0.60f))
                    Text("暂时无法加载图片", color = Color.White.copy(alpha = 0.75f), style = MiuixTheme.textStyles.footnote1)
                    TextButton(
                        "重试", enabled = active, onClick = { attempt++ }, minHeight = 40.dp,
                        insideMargin = PaddingValues(horizontal = 24.dp, vertical = 8.dp),
                        colors = ButtonDefaults.textButtonColors(color = Color.White.copy(alpha = 0.14f), textColor = Color.White),
                    )
                }
                else -> Box(Modifier.size(1.dp))
            }
        }
    }
}

@Composable
private fun rememberViewerImage(container: AppContainer, url: String): RemoteImageState {
    if (!url.startsWith("data:image/")) return rememberRemoteImageState(container.apiClient.remoteImages, url, 2048)
    val state by produceState(RemoteImageState(), url) {
        val bitmap = withContext(Dispatchers.Default) { decodeDataUrlBitmap(url, 2048)?.asImageBitmap() }
        value = RemoteImageState(bitmap, loading = false)
    }
    return state
}

/** Pan limits use the fitted bitmap bounds, not the full-screen Image composable. */
private fun boundedImagePan(offset: Offset, scale: Float, bitmap: ImageBitmap?, viewport: IntSize): Offset {
    if (bitmap == null || viewport.width == 0 || viewport.height == 0) return Offset.Zero
    val fit = min(viewport.width.toFloat() / bitmap.width, viewport.height.toFloat() / bitmap.height)
    val horizontal = max(0f, (bitmap.width * fit * scale - viewport.width) / 2f)
    val vertical = max(0f, (bitmap.height * fit * scale - viewport.height) / 2f)
    return Offset(offset.x.coerceIn(-horizontal, horizontal), offset.y.coerceIn(-vertical, vertical))
}
