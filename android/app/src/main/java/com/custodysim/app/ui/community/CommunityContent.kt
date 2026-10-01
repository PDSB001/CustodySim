package com.custodysim.app.ui.community

import androidx.compose.foundation.Image
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.community.*
import com.custodysim.app.ui.common.rememberRemoteImageState
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Delete
import top.yukonga.miuix.kmp.icon.extended.Lock
import top.yukonga.miuix.kmp.icon.extended.Messages
import top.yukonga.miuix.kmp.icon.extended.Photos
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.PressFeedbackType
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun CommunityFeedContent(
    container: AppContainer, posts: List<CommunityPost>, loading: Boolean, more: Boolean, error: String?,
    state: LazyListState, modifier: Modifier = Modifier, onRetry: () -> Unit, onCompose: () -> Unit,
    onPost: (String) -> Unit, onMore: () -> Unit,
) {
    val reduceMotion = LocalEffects.current.reduceMotion
    var previousPosts by remember { mutableStateOf(posts) }
    SideEffect { if (posts.isNotEmpty()) previousPosts = posts }
    Column(modifier.fillMaxSize()) {
        CommunityPrivacyNote("在这里分享日常，用匿名身份交流",
            Modifier.padding(horizontal = AppSpace.inset, vertical = AppSpace.small))
        CommunityReadStatus(loading && posts.isNotEmpty(), error.takeIf { posts.isNotEmpty() }, onRetry)
        AnimatedContent(
            targetState = posts.isNotEmpty(), modifier = Modifier.weight(1f).fillMaxWidth(),
            transitionSpec = {
                fadeIn(tween(if (reduceMotion) 0 else 220, easing = FastOutSlowInEasing)) togetherWith
                    fadeOut(tween(if (reduceMotion) 0 else 150)) using null
            }, label = "community-feed-state",
        ) { hasPosts ->
            if (!hasPosts) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = AppSpace.page)) {
                    CommunityEmptyState(
                        title = when { loading -> "正在加载社区"; error != null -> "暂时无法连接社区"; else -> "聊聊你的日常" },
                        description = when { loading -> "稍等片刻，看看大家的新分享"; error != null -> error; else -> "这里还很安静，写下第一篇分享吧" },
                        loading = loading, action = if (error != null) "重试" else "发布第一篇", onAction = if (error != null) onRetry else onCompose,
                        modifier = Modifier.fillMaxWidth().padding(top = 64.dp, bottom = 40.dp),
                    )
                }
            } else {
                val visiblePosts = if (posts.isNotEmpty()) posts else previousPosts
                LazyColumn(Modifier.fillMaxSize(), state = state,
                    contentPadding = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.small),
                    verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                    items(visiblePosts, key = { it.id }, contentType = { "post" }) { post ->
                        Card(
                            modifier = Modifier.fillMaxWidth().animateItem(
                                fadeInSpec = if (reduceMotion) null else tween(220),
                                placementSpec = if (reduceMotion) null else tween(280, easing = FastOutSlowInEasing),
                                fadeOutSpec = if (reduceMotion) null else tween(160),
                            ),
                            insideMargin = PaddingValues(AppSpace.inset), cornerRadius = AppShape.group,
                            onClick = { onPost(post.id) }, showIndication = true,
                            pressFeedbackType = if (reduceMotion) PressFeedbackType.None else PressFeedbackType.Sink,
                        ) {
                            CommunityAuthor(post.authorLabel, post.isOwn, post.createdAt)
                            Spacer(Modifier.height(AppSpace.medium))
                            Text(post.title, style = MiuixTheme.textStyles.body1.copy(fontWeight = FontWeight.SemiBold, fontSize = 18.sp),
                                maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (post.content.isNotBlank()) {
                                Spacer(Modifier.height(6.dp))
                                Text(post.content, style = MiuixTheme.textStyles.body1.copy(fontSize = 15.sp, lineHeight = 23.sp),
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            }
                            if (post.imageUrls.isNotEmpty()) {
                                Spacer(Modifier.height(AppSpace.medium))
                                CommunityImageGrid(container, post.imageUrls, onPreview = null)
                            }
                            Spacer(Modifier.height(AppSpace.page))
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(MiuixIcons.Messages, null, modifier = Modifier.size(16.dp), tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                AnimatedContent(post.commentCount, transitionSpec = {
                                    fadeIn(tween(if (reduceMotion) 0 else 170)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 110)) using null
                                }, label = "feed-comment-count") { count ->
                                    Text(if (count == 0) "来聊聊" else "$count 条评论", style = MiuixTheme.textStyles.footnote2,
                                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                }
                                Spacer(Modifier.weight(1f))
                                if (post.profileSnapshot.isNotEmpty()) CommunityTag("档案分享")
                            }
                        }
                    }
                    item(key = "footer") {
                        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = AppSpace.small), contentAlignment = Alignment.Center) {
                            if (more) TextButton(if (loading) "加载中…" else "查看更多", onClick = onMore, enabled = !loading,
                                minHeight = 40.dp, insideMargin = PaddingValues(horizontal = 24.dp, vertical = 8.dp), textStyle = MiuixTheme.textStyles.footnote1)
                            else Text("已看到全部分享", style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun CommunityThread(
    container: AppContainer, detail: CommunityDetail?, loading: Boolean, error: String?, page: Int, enabled: Boolean,
    state: LazyListState, onRetry: () -> Unit, onPage: (Int) -> Unit, onDelete: (String, String) -> Unit,
    onPreview: (List<String>, Int) -> Unit,
) {
    val reduceMotion = LocalEffects.current.reduceMotion
    var previousDetail by remember { mutableStateOf(detail) }
    SideEffect { if (detail != null) previousDetail = detail }
    Column(Modifier.fillMaxSize()) {
        CommunityReadStatus(loading && detail != null, error.takeIf { detail != null }, onRetry)
        AnimatedContent(detail != null, modifier = Modifier.weight(1f).fillMaxWidth(), transitionSpec = {
            fadeIn(tween(if (reduceMotion) 0 else 220, easing = FastOutSlowInEasing)) togetherWith
                fadeOut(tween(if (reduceMotion) 0 else 150)) using null
        }, label = "community-thread-state") { hasDetail ->
            if (!hasDetail) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = AppSpace.page)) {
                    CommunityEmptyState(if (loading) "正在打开帖子" else "暂时无法打开帖子", error ?: "稍等片刻", loading,
                        "重试", onRetry, Modifier.fillMaxWidth().padding(top = 64.dp, bottom = 40.dp))
                }
            } else {
                val visibleDetail = detail ?: previousDetail
                if (visibleDetail != null) CommunityThreadItems(
                    container, visibleDetail, loading, page, enabled, state, onPage, onDelete, onPreview,
                )
            }
        }
    }
}

@Composable
private fun CommunityThreadItems(
    container: AppContainer, detail: CommunityDetail, loading: Boolean, page: Int, enabled: Boolean,
    state: LazyListState, onPage: (Int) -> Unit, onDelete: (String, String) -> Unit,
    onPreview: (List<String>, Int) -> Unit,
) {
    val reduceMotion = LocalEffects.current.reduceMotion
    LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(AppSpace.page),
        verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
            item(key = "article") {
                Card(Modifier.fillMaxWidth(), insideMargin = PaddingValues(AppSpace.inset), cornerRadius = AppShape.group) {
                    CommunityAuthor(detail.post.authorLabel, detail.post.isOwn, detail.post.createdAt)
                    Spacer(Modifier.height(AppSpace.page))
                    Text(detail.post.title, style = MiuixTheme.textStyles.title2.copy(fontSize = 22.sp, lineHeight = 31.sp))
                    if (detail.post.content.isNotBlank()) {
                        Spacer(Modifier.height(AppSpace.medium))
                        Text(detail.post.content, style = MiuixTheme.textStyles.body1.copy(fontSize = 16.sp, lineHeight = 27.sp))
                    }
                    if (detail.post.profileSnapshot.isNotEmpty()) {
                        Spacer(Modifier.height(AppSpace.page))
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MiuixTheme.colorScheme.surface)
                            .padding(AppSpace.page), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                            CommunityTag("自愿分享的档案")
                            detail.post.profileSnapshot.forEach { field ->
                                Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                                    Text(field.name, Modifier.width(88.dp), style = MiuixTheme.textStyles.footnote1,
                                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                                    Text(field.value, Modifier.weight(1f), style = MiuixTheme.textStyles.footnote1)
                                }
                            }
                        }
                    }
                    if (detail.post.imageUrls.isNotEmpty()) {
                        Spacer(Modifier.height(AppSpace.page))
                        CommunityImageGrid(container, detail.post.imageUrls, { index -> onPreview(detail.post.imageUrls, index) }, expanded = true)
                    }
                }
            }
            item(key = "comments-header") {
                Row(Modifier.padding(horizontal = 4.dp, vertical = AppSpace.small), verticalAlignment = Alignment.CenterVertically) {
                    Text("评论", style = MiuixTheme.textStyles.body1.copy(fontWeight = FontWeight.Medium))
                    AnimatedContent(detail.post.commentCount, transitionSpec = {
                        fadeIn(tween(if (reduceMotion) 0 else 160)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 100)) using null
                    }, label = "thread-comment-count") { count ->
                        Text("  $count", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    }
                    Spacer(Modifier.weight(1f))
                    Text("同帖匿名编号固定", style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
            }
            if (detail.comments.isEmpty() && !loading) item(key = "no-comments") {
                Text("还没有评论，来聊聊吧", Modifier.fillMaxWidth().animateItem(
                    fadeInSpec = if (reduceMotion) null else tween(180),
                    placementSpec = if (reduceMotion) null else tween(220, easing = FastOutSlowInEasing),
                    fadeOutSpec = if (reduceMotion) null else tween(120),
                ).padding(horizontal = 4.dp, vertical = AppSpace.section),
                    style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
            items(detail.comments, key = { it.id }, contentType = { "comment" }) { reply ->
                Column(Modifier.fillMaxWidth().animateItem(
                    fadeInSpec = if (reduceMotion) null else tween(200),
                    placementSpec = if (reduceMotion) null else tween(260, easing = FastOutSlowInEasing),
                    fadeOutSpec = if (reduceMotion) null else tween(160),
                ).padding(horizontal = 4.dp, vertical = AppSpace.small)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CommunityAuthor(reply.authorLabel, reply.isOwn, reply.createdAt, Modifier.weight(1f), compact = true)
                        if (reply.canDelete) CommunityActionIconButton(onClick = { onDelete("comments", reply.id) }, enabled = enabled) {
                            Icon(MiuixIcons.Delete, "删除这条评论", Modifier.size(18.dp), tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        }
                    }
                    Spacer(Modifier.height(AppSpace.small))
                    Text(reply.content, style = MiuixTheme.textStyles.body1.copy(fontSize = 15.sp, lineHeight = 24.sp))
                    Spacer(Modifier.height(AppSpace.page))
                    CommunityHairline()
                }
            }
            if (page > 0 || detail.hasMore) item(key = "pagination") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    TextButton("上一页", enabled = enabled && !loading && page > 0, onClick = { onPage(page - 1) },
                        insideMargin = PaddingValues(horizontal = 16.dp, vertical = 8.dp), textStyle = MiuixTheme.textStyles.footnote1)
                    AnimatedContent(page, transitionSpec = {
                        fadeIn(tween(if (reduceMotion) 0 else 160)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 100)) using null
                    }, label = "comment-page") { shownPage ->
                        Text("第 ${shownPage + 1} 页", style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    }
                    TextButton("下一页", enabled = enabled && !loading && detail.hasMore, onClick = { onPage(page + 1) },
                        insideMargin = PaddingValues(horizontal = 16.dp, vertical = 8.dp), textStyle = MiuixTheme.textStyles.footnote1)
                }
            }
    }
}

@Composable
private fun CommunityImageGrid(container: AppContainer, urls: List<String>, onPreview: ((Int) -> Unit)?, expanded: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
        urls.forEachIndexed { index, url ->
            // Include the URL so an updated attachment never inherits the previous
            // thumbnail's request/reveal state. The index permits repeated URLs.
            key(url, index) {
                val aspect = if (urls.size == 1) (if (expanded) 1.25f else 1.65f) else 1f
                CommunityRemoteImage(container, url, Modifier.weight(1f).aspectRatio(aspect), index,
                    onClick = onPreview?.let { { it(index) } })
            }
        }
    }
}

@Composable
private fun CommunityRemoteImage(container: AppContainer, url: String, modifier: Modifier, index: Int, onClick: (() -> Unit)?) {
    val reduceMotion = LocalEffects.current.reduceMotion
    var attempt by remember(url) { mutableIntStateOf(0) }
    val image = key(attempt) { rememberRemoteImageState(container.apiClient.remoteImages, url, 640) }
    val bitmap = image.bitmap
    val reveal by animateFloatAsState(
        targetValue = if (bitmap != null) 1f else 0f,
        animationSpec = tween(if (reduceMotion) 0 else 180, easing = FastOutSlowInEasing),
        label = "community-thumbnail-reveal",
    )
    val failed = !image.loading && bitmap == null
    val canPreview = bitmap != null && onClick != null
    Box(modifier.clip(RoundedCornerShape(AppShape.thumbnail)).background(MiuixTheme.colorScheme.surface)
        .then(if (failed || canPreview) Modifier.clickable(onClickLabel = if (failed) "重试图片" else "查看图片") {
            if (failed) attempt++ else onClick?.invoke()
        } else Modifier), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap, "帖子图片 ${index + 1}",
            Modifier.fillMaxSize().graphicsLayer { alpha = reveal }, contentScale = ContentScale.Crop)
        // Let the outgoing loading/error content finish fading in fixed thumbnail
        // bounds; a successful decode must not momentarily show the retry state.
        val status = when { bitmap != null -> "ready"; image.loading -> "loading"; else -> "error" }
        AnimatedContent(
            targetState = status,
            contentAlignment = Alignment.Center,
            transitionSpec = {
                fadeIn(tween(if (reduceMotion) 0 else 150)) togetherWith fadeOut(tween(if (reduceMotion) 0 else 120)) using null
            }, label = "community-thumbnail-state",
        ) { state ->
            when (state) {
                "loading" -> CircularProgressIndicator(size = 22.dp)
                "error" -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(MiuixIcons.Photos, null, Modifier.size(24.dp), tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    Text("点击重试", style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
                else -> Box(Modifier.size(1.dp))
            }
        }
    }
}

@Composable
private fun CommunityAuthor(label: String, own: Boolean, createdAt: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
        if (!compact) Box(Modifier.size(32.dp).background(MiuixTheme.colorScheme.primary.copy(alpha = 0.08f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(MiuixIcons.Lock, null, Modifier.size(17.dp), tint = MiuixTheme.colorScheme.primary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(if (label == "楼主") "匿名楼主" else label, style = MiuixTheme.textStyles.footnote1.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (own) CommunityTag("我")
            }
            Text(communityTime(createdAt), style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        }
    }
}

@Composable
private fun CommunityTag(text: String) {
    Text(text, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(MiuixTheme.colorScheme.primary.copy(alpha = 0.08f)).padding(horizontal = 6.dp, vertical = 2.dp),
        style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.primary)
}

@Composable
internal fun CommunityPrivacyNote(text: String, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(MiuixIcons.Lock, null, Modifier.size(15.dp), tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        Text(text, style = MiuixTheme.textStyles.footnote2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
    }
}

@Composable
private fun CommunityEmptyState(title: String, description: String, loading: Boolean, action: String, onAction: () -> Unit, modifier: Modifier = Modifier) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val presentation = CommunityEmptyPresentation(title, description, loading, action)
    AnimatedContent(presentation, modifier.padding(horizontal = AppSpace.section), transitionSpec = {
        fadeIn(tween(if (reduceMotion) 0 else 200, delayMillis = if (reduceMotion) 0 else 60)) togetherWith
            fadeOut(tween(if (reduceMotion) 0 else 120)) using SizeTransform(clip = false) { _, _ ->
                tween(if (reduceMotion) 0 else 220, easing = FastOutSlowInEasing)
            }
    }, contentAlignment = Alignment.TopCenter, label = "community-empty-state") { shown ->
      Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(72.dp).background(MiuixTheme.colorScheme.primary.copy(alpha = 0.07f), RoundedCornerShape(24.dp)), contentAlignment = Alignment.Center) {
            if (shown.loading) CircularProgressIndicator(size = 28.dp)
            else Icon(MiuixIcons.Messages, null, Modifier.size(34.dp), tint = MiuixTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(AppSpace.section))
        Text(shown.title, style = MiuixTheme.textStyles.body1.copy(fontSize = 20.sp, fontWeight = FontWeight.Medium), textAlign = TextAlign.Center)
        Spacer(Modifier.height(AppSpace.small))
        Text(shown.description, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary, textAlign = TextAlign.Center)
        if (!shown.loading) {
            Spacer(Modifier.height(AppSpace.section))
            Button(onClick = onAction, enabled = shown == presentation, colors = ButtonDefaults.buttonColorsPrimary(),
                insideMargin = PaddingValues(horizontal = 24.dp, vertical = 11.dp), cornerRadius = 16.dp) {
                Text(shown.action, style = MiuixTheme.textStyles.button)
            }
        }
      }
    }
}

private data class CommunityEmptyPresentation(val title: String, val description: String, val loading: Boolean, val action: String)

@Composable
internal fun CommunityHairline() {
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(MiuixTheme.colorScheme.onSurface.copy(alpha = 0.06f)))
}

internal fun communityTime(value: String): String = runCatching {
    val time = Instant.parse(value)
    val elapsed = Duration.between(time, Instant.now())
    when {
        elapsed.isNegative -> time.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"))
        elapsed.toMinutes() < 1 -> "刚刚"
        elapsed.toHours() < 1 -> "${elapsed.toMinutes()} 分钟前"
        elapsed.toDays() < 1 -> "${elapsed.toHours()} 小时前"
        else -> time.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"))
    }
}.getOrDefault("时间未知")

