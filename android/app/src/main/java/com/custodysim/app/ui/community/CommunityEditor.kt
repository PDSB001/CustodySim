package com.custodysim.app.ui.community

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.custodysim.app.data.media.decodeDataUrlBitmap
import com.custodysim.app.ui.common.RemoteImageState
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Clear
import top.yukonga.miuix.kmp.icon.extended.Photos
import top.yukonga.miuix.kmp.icon.extended.Send
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun CommunityPublishButton(busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val scheme = MiuixTheme.colorScheme
    val active = enabled && !busy
    val background by animateColorAsState(
        if (active || busy) scheme.primary else scheme.disabledPrimaryButton,
        tween(if (reduceMotion) 0 else 180), label = "publish-background",
    )
    val foreground by animateColorAsState(
        if (active || busy) scheme.onPrimary else scheme.disabledOnPrimaryButton,
        tween(if (reduceMotion) 0 else 180), label = "publish-foreground",
    )
    val interaction = remember { MutableInteractionSource() }
    val scale = communityPressedScale(interaction, active)
    Button(
        onClick = onClick, enabled = active,
        modifier = Modifier.padding(start = 8.dp).graphicsLayer { scaleX = scale; scaleY = scale }
            .semantics { if (busy) stateDescription = "正在发布" },
        minWidth = 76.dp, minHeight = 40.dp, cornerRadius = 12.dp,
        insideMargin = PaddingValues(horizontal = 16.dp, vertical = 7.dp),
        interactionSource = interaction,
        colors = ButtonDefaults.buttonColors(background, background, foreground, foreground),
    ) {
        // Reserve the label's actual height even at large font scales. Neither state
        // changes the button's bounds or squeezes the spinner into text line metrics.
        Box(Modifier.widthIn(min = 44.dp).heightIn(min = 26.dp), contentAlignment = Alignment.Center) {
            Text("发布", Modifier.alpha(0f).clearAndSetSemantics {}, style = MiuixTheme.textStyles.button)
            AnimatedContent(
                targetState = busy, contentAlignment = Alignment.Center, transitionSpec = {
                    fadeIn(tween(if (reduceMotion) 0 else 120, delayMillis = if (reduceMotion) 0 else 70)) togetherWith
                        fadeOut(tween(if (reduceMotion) 0 else 70)) using null
                }, label = "publish-content",
            ) { sending ->
                if (sending) CommunityButtonSpinner() else Text("发布", style = MiuixTheme.textStyles.button)
            }
        }
    }
}

@Composable
internal fun CommunityEditor(
    title: String, body: String, images: List<String>, preparing: Boolean, publishing: Boolean, progress: Int,
    ready: Boolean, error: String?, state: LazyListState, onTitle: (String) -> Unit, onBody: (String) -> Unit,
    onAdd: () -> Unit, onRemove: (Int) -> Unit, onPreview: (Int) -> Unit,
) {
    val enabled = ready && !publishing
    val reduceMotion = LocalEffects.current.reduceMotion
    val bodyFocus = remember { FocusRequester() }
    var lastError by remember { mutableStateOf(error) }
    SideEffect { if (error != null) lastError = error }
    LazyColumn(
        Modifier.fillMaxSize().imePadding(), state = state,
        contentPadding = PaddingValues(AppSpace.page), verticalArrangement = Arrangement.spacedBy(AppSpace.page),
    ) {
        item(key = "privacy") {
            Column {
                CommunityPrivacyNote("匿名发布 · 不展示你的用户名", Modifier.padding(horizontal = 4.dp))
                AnimatedVisibility(
                    visible = error != null,
                    enter = fadeIn(tween(if (reduceMotion) 0 else 160)) + expandVertically(tween(if (reduceMotion) 0 else 180), clip = false),
                    exit = fadeOut(tween(if (reduceMotion) 0 else 120)) + shrinkVertically(tween(if (reduceMotion) 0 else 160), clip = false),
                ) {
                    Text(error ?: lastError.orEmpty(), color = MiuixTheme.colorScheme.error, style = MiuixTheme.textStyles.footnote1,
                        modifier = Modifier.padding(horizontal = 4.dp).padding(top = AppSpace.page))
                }
            }
        }
        item(key = "writing") {
            Card(Modifier.fillMaxWidth(), insideMargin = PaddingValues(AppSpace.inset), cornerRadius = AppShape.group) {
                CommunityEditorField(
                    value = title, onChange = { onTitle(it.replace(Regex("[\\r\\n]+"), " ").take(120)) },
                    placeholder = "写一个标题", enabled = enabled, singleLine = true,
                    style = MiuixTheme.textStyles.title2.copy(fontSize = 21.sp, lineHeight = 29.sp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { bodyFocus.requestFocus() }),
                )
                Spacer(Modifier.height(4.dp))
                CommunityHairline()
                Spacer(Modifier.height(AppSpace.small))
                CommunityEditorField(
                    value = body, onChange = { onBody(it.take(5000)) }, placeholder = "今天有什么想分享的？",
                    enabled = enabled, minLines = 7, maxLines = 12, modifier = Modifier.focusRequester(bodyFocus),
                    style = MiuixTheme.textStyles.body1.copy(fontSize = 16.sp, lineHeight = 26.sp),
                )
                Row(Modifier.fillMaxWidth().padding(top = AppSpace.small), horizontalArrangement = Arrangement.SpaceBetween) {
                    CommunityCharacterCount(title.length, 120, "标题")
                    CommunityCharacterCount(body.length, 5000, "正文")
                }
            }
        }
        item(key = "photos") {
            Card(Modifier.fillMaxWidth(), insideMargin = PaddingValues(AppSpace.inset), cornerRadius = AppShape.group) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("图片", style = MiuixTheme.textStyles.body1.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium))
                    Spacer(Modifier.weight(1f))
                    AnimatedContent(
                        targetState = preparing, transitionSpec = {
                            fadeIn(tween(if (reduceMotion) 0 else 150)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 100)) using null
                        }, label = "image-processing-label",
                    ) { processing ->
                        Text(if (processing) "正在处理图片…" else "${images.size} / 3", style = MiuixTheme.textStyles.footnote2,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    }
                }
                Spacer(Modifier.height(AppSpace.medium))
                CommunityEditorPhotos(images, preparing, enabled, onAdd, onRemove, onPreview)
            }
        }
        item(key = "reminder") {
            Column {
                AnimatedVisibility(
                    visible = publishing || preparing,
                    enter = fadeIn(tween(if (reduceMotion) 0 else 180)) + expandVertically(tween(if (reduceMotion) 0 else 220), clip = false),
                    exit = fadeOut(tween(if (reduceMotion) 0 else 100)) + shrinkVertically(tween(if (reduceMotion) 0 else 180), clip = false),
                ) {
                    Column {
                        CommunityEditorProgress(preparing, publishing, images.isNotEmpty(), progress)
                        Spacer(Modifier.height(AppSpace.page))
                    }
                }
                Text("请勿在文字或图片中透露姓名、账号等身份信息。返回时会保留草稿。",
                    style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    modifier = Modifier.padding(horizontal = 4.dp))
            }
        }
    }
}

@Composable
private fun CommunityEditorField(
    value: String, onChange: (String) -> Unit, placeholder: String, enabled: Boolean, style: TextStyle,
    modifier: Modifier = Modifier, singleLine: Boolean = false, minLines: Int = 1, maxLines: Int = Int.MAX_VALUE,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default,
    insideMargin: DpSize = DpSize(0.dp, 8.dp), background: Color = Color.Transparent, cornerRadius: androidx.compose.ui.unit.Dp = 0.dp,
) {
    val scheme = MiuixTheme.colorScheme
    val reduceMotion = LocalEffects.current.reduceMotion
    val placeholderAlpha by animateFloatAsState(if (value.isEmpty()) 1f else 0f,
        tween(if (reduceMotion) 0 else 100), label = "editor-placeholder")
    Box(modifier.fillMaxWidth()) {
        // Miuix's built-in label has its own font size and weight. An empty native
        // label lets the placeholder share the cursor/text baseline and typography.
        TextField(
            value = value, onValueChange = onChange,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder }, label = "",
            enabled = enabled, singleLine = singleLine, minLines = minLines, maxLines = maxLines,
            insideMargin = insideMargin, cornerRadius = cornerRadius,
            colors = TextFieldDefaults.textFieldColors(backgroundColor = background, borderColor = Color.Transparent),
            cursorBrush = SolidColor(scheme.primary), textStyle = style.copy(color = scheme.onSurface),
            keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
        )
        // Hide immediately on the first character, so placeholder and typed text
        // never overlap during the fade; clearing the field still fades it in.
        if (value.isEmpty() && placeholderAlpha > 0f) Text(
            placeholder, style = style, color = scheme.onSurfaceVariantSummary.copy(alpha = 0.65f),
            maxLines = if (singleLine) 1 else 2,
            modifier = Modifier.padding(horizontal = insideMargin.width, vertical = insideMargin.height)
                .alpha(placeholderAlpha).clearAndSetSemantics {},
        )
    }
}

@Composable
private fun CommunityCharacterCount(count: Int, limit: Int, label: String) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val color by animateColorAsState(
        if (count >= limit) MiuixTheme.colorScheme.error else MiuixTheme.colorScheme.onSurfaceVariantSummary,
        tween(if (reduceMotion) 0 else 180), label = "editor-character-limit",
    )
    Text("$label $count / $limit", style = MiuixTheme.textStyles.footnote2, color = color)
}

@Composable
private fun CommunityEditorPhotos(
    images: List<String>, preparing: Boolean, enabled: Boolean, onAdd: () -> Unit,
    onRemove: (Int) -> Unit, onPreview: (Int) -> Unit,
) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val focus = LocalFocusManager.current
    val latestImages by rememberUpdatedState(images)
    // Keep outgoing URLs until their exit completes; decoding state follows the URL,
    // while positions slide to the remaining fixed-width slots after a removal.
    val rendered = remember { mutableStateListOf<String>().apply { addAll(images.distinct()) } }
    LaunchedEffect(images, reduceMotion) {
        rendered.addAll(images.filterNot { it in rendered }.distinct())
        if (reduceMotion) rendered.removeAll { it !in images }
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val cell = (maxWidth - AppSpace.small * 2) / 3
        Box(Modifier.fillMaxWidth().height(cell)) {
            rendered.toList().forEach { url -> key(url) {
                val index = images.indexOf(url)
                var lastIndex by remember(url) { mutableIntStateOf(index.coerceAtLeast(0)) }
                SideEffect { if (index >= 0) lastIndex = index }
                val x by animateDpAsState((cell + AppSpace.small) * (if (index >= 0) index else lastIndex),
                    tween(if (reduceMotion) 0 else 240, easing = FastOutSlowInEasing), label = "editor-image-position")
                val visible = remember(url) { MutableTransitionState(reduceMotion).apply { targetState = true } }
                visible.targetState = index >= 0
                LaunchedEffect(visible.isIdle, visible.currentState, index) {
                    if (index < 0 && visible.isIdle && !visible.currentState) rendered.remove(url)
                }
                AnimatedVisibility(
                    visibleState = visible, modifier = Modifier.offset(x = x).size(cell),
                    enter = fadeIn(tween(if (reduceMotion) 0 else 180)) + scaleIn(tween(if (reduceMotion) 0 else 220), initialScale = 0.94f),
                    exit = fadeOut(tween(if (reduceMotion) 0 else 140)) + scaleOut(tween(if (reduceMotion) 0 else 180), targetScale = 0.94f),
                ) {
                    CommunityEditorPhoto(
                        url = url, number = (if (index >= 0) index else lastIndex) + 1,
                        enabled = enabled && !preparing && index >= 0,
                        onRemove = {
                            val currentIndex = latestImages.indexOf(url)
                            if (currentIndex >= 0) onRemove(currentIndex)
                        },
                        onPreview = {
                            val currentIndex = latestImages.indexOf(url)
                            if (currentIndex >= 0) { focus.clearFocus(); onPreview(currentIndex) }
                        },
                    )
                }
            } }
            val addX by animateDpAsState((cell + AppSpace.small) * images.size.coerceAtMost(2),
                tween(if (reduceMotion) 0 else 240, easing = FastOutSlowInEasing), label = "editor-add-position")
            AnimatedVisibility(
                visible = images.size < 3, modifier = Modifier.offset(x = addX).size(cell),
                enter = fadeIn(tween(if (reduceMotion) 0 else 180)), exit = fadeOut(tween(if (reduceMotion) 0 else 100)),
            ) {
                val interaction = remember { MutableInteractionSource() }
                val active = enabled && !preparing && images.size < 3
                val scale = communityPressedScale(interaction, active)
                Box(
                    Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale }
                        .clip(RoundedCornerShape(AppShape.thumbnail)).background(MiuixTheme.colorScheme.surface)
                        .clickable(enabled = active, interactionSource = interaction, indication = androidx.compose.foundation.LocalIndication.current,
                            onClick = { focus.clearFocus(); onAdd() }), contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        AnimatedContent(targetState = preparing, transitionSpec = {
                            fadeIn(tween(if (reduceMotion) 0 else 150)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 100)) using null
                        }, label = "editor-add-processing") { processing ->
                            Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
                                if (processing) CircularProgressIndicator(size = 22.dp)
                                else Icon(MiuixIcons.Photos, "添加图片", Modifier.size(26.dp), tint = MiuixTheme.colorScheme.primary)
                            }
                        }
                        Text(if (preparing) "处理中" else "添加图片", style = MiuixTheme.textStyles.footnote2,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    }
                }
            }
        }
    }
}

@Composable
private fun CommunityEditorPhoto(url: String, number: Int, enabled: Boolean, onRemove: () -> Unit, onPreview: () -> Unit) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val image by produceState(RemoteImageState(), url) {
        val bitmap = withContext(Dispatchers.Default) { runCatching { decodeDataUrlBitmap(url, 512)?.asImageBitmap() }.getOrNull() }
        value = RemoteImageState(bitmap, loading = false)
    }
    val imageAlpha by animateFloatAsState(if (image.bitmap != null) 1f else 0f,
        tween(if (reduceMotion) 0 else 180), label = "editor-image-decoded")
    val interaction = remember { MutableInteractionSource() }
    val scale = communityPressedScale(interaction, enabled && image.bitmap != null)
    Box(
        Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(AppShape.thumbnail)).background(MiuixTheme.colorScheme.surface),
        contentAlignment = Alignment.Center,
    ) {
        image.bitmap?.let { bitmap ->
            Image(bitmap, "所选图片 $number", Modifier.fillMaxSize().alpha(imageAlpha)
                .clickable(enabled = enabled, interactionSource = interaction, indication = androidx.compose.foundation.LocalIndication.current, onClick = onPreview),
                contentScale = ContentScale.Crop)
        } ?: if (image.loading) CircularProgressIndicator(size = 22.dp) else {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(MiuixIcons.Photos, null, Modifier.size(22.dp), tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                Text("图片不可用", style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
        }
        // Keep the touch target larger than the visible removal glyph.
        Button(
            onClick = onRemove, enabled = enabled, modifier = Modifier.align(Alignment.TopEnd).padding(2.dp),
            minWidth = 36.dp, minHeight = 36.dp, cornerRadius = 12.dp, insideMargin = PaddingValues(0.dp),
            colors = ButtonDefaults.buttonColors(
                color = MiuixTheme.colorScheme.background.copy(alpha = 0.92f),
                disabledColor = MiuixTheme.colorScheme.background.copy(alpha = 0.72f),
                contentColor = MiuixTheme.colorScheme.onSurface,
            ),
        ) { Icon(MiuixIcons.Clear, "移除图片 $number", Modifier.size(16.dp)) }
    }
}

@Composable
private fun CommunityEditorProgress(preparing: Boolean, publishing: Boolean, hasImages: Boolean, progress: Int) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val upload by animateFloatAsState(progress.coerceIn(0, 100) / 100f,
        tween(if (reduceMotion) 0 else 220), label = "community-upload-progress")
    val stage = when { preparing && !publishing -> "prepare"; hasImages && progress < 100 -> "upload"; else -> "publish" }
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
        AnimatedContent(targetState = stage, transitionSpec = {
            fadeIn(tween(if (reduceMotion) 0 else 160)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 100)) using null
        }, label = "community-upload-stage") { current ->
            Text(when (current) { "prepare" -> "正在处理图片…"; "upload" -> "正在上传图片 ${progress.coerceIn(0, 100)}%"; else -> "正在发布帖子…" },
                style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary)
        }
        Box(Modifier.fillMaxWidth().height(3.dp)) {
            LinearProgressIndicator(progress = if (stage == "upload") upload else null, height = 3.dp)
        }
    }
}

@Composable
internal fun CommunityCommentBar(value: String, onChange: (String) -> Unit, busy: Boolean, enabled: Boolean, onSend: () -> Unit) {
    val canSend = enabled && !busy && value.isNotBlank()
    val reduceMotion = LocalEffects.current.reduceMotion
    val scheme = MiuixTheme.colorScheme
    val background by animateColorAsState(if (canSend || busy) scheme.primary else scheme.surface,
        tween(if (reduceMotion) 0 else 180), label = "comment-send-background")
    val foreground by animateColorAsState(if (canSend || busy) scheme.onPrimary else scheme.onSurfaceVariantSummary,
        tween(if (reduceMotion) 0 else 180), label = "comment-send-foreground")
    val interaction = remember { MutableInteractionSource() }
    val scale = communityPressedScale(interaction, canSend)
    Box(Modifier.fillMaxWidth().background(scheme.background).navigationBarsPadding().imePadding(), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = AppSpace.contentWidth).fillMaxWidth()) {
            CommunityHairline()
            Row(Modifier.fillMaxWidth().padding(horizontal = AppSpace.page, vertical = AppSpace.medium),
                verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                CommunityEditorField(
                    value = value, onChange = { onChange(it.take(2000)) }, placeholder = "说点什么…", enabled = enabled && !busy,
                    modifier = Modifier.weight(1f), maxLines = 4,
                    insideMargin = DpSize(16.dp, 12.dp), background = scheme.surface, cornerRadius = AppShape.control,
                    style = MiuixTheme.textStyles.body1.copy(fontSize = 15.sp, lineHeight = 22.sp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { if (canSend) onSend() }),
                )
                Button(
                    onClick = { if (canSend) onSend() }, enabled = canSend,
                    modifier = Modifier.size(46.dp).graphicsLayer { scaleX = scale; scaleY = scale }
                        .semantics { contentDescription = "发送匿名评论"; if (busy) stateDescription = "正在发送" },
                    minWidth = 46.dp, minHeight = 46.dp, cornerRadius = 16.dp, insideMargin = PaddingValues(0.dp),
                    interactionSource = interaction, colors = ButtonDefaults.buttonColors(background, background, foreground, foreground),
                ) {
                    AnimatedContent(targetState = busy, contentAlignment = Alignment.Center, transitionSpec = {
                        fadeIn(tween(if (reduceMotion) 0 else 120, delayMillis = if (reduceMotion) 0 else 70)) togetherWith
                            fadeOut(tween(if (reduceMotion) 0 else 70)) using null
                    }, label = "comment-send-content") { sending ->
                        if (sending) CommunityButtonSpinner() else Icon(MiuixIcons.Send, null, Modifier.size(24.dp), tint = foreground)
                    }
                }
            }
        }
    }
}

@Composable
private fun CommunityButtonSpinner() {
    Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(size = 22.dp, strokeWidth = 2.5.dp,
            colors = ProgressIndicatorDefaults.progressIndicatorColors(
                foregroundColor = MiuixTheme.colorScheme.onPrimary,
                backgroundColor = MiuixTheme.colorScheme.onPrimary.copy(alpha = 0.20f),
            ))
    }
}

@Composable
private fun communityPressedScale(interaction: MutableInteractionSource, enabled: Boolean): Float {
    val pressed by interaction.collectIsPressedAsState()
    val reduceMotion = LocalEffects.current.reduceMotion
    return animateFloatAsState(if (pressed && enabled && !reduceMotion) 0.97f else 1f,
        tween(if (reduceMotion) 0 else if (pressed) 90 else 180, easing = FastOutSlowInEasing), label = "community-control-press").value
}
