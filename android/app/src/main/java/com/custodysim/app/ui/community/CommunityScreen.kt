package com.custodysim.app.ui.community

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import com.custodysim.app.AppContainer
import com.custodysim.app.data.community.*
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Back
import top.yukonga.miuix.kmp.icon.extended.Delete
import top.yukonga.miuix.kmp.icon.extended.Edit
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun CommunityScreen(container: AppContainer, onClose: () -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val notify: (String) -> Unit = remember(snackbar, scope) {
        { message -> scope.launch {
            snackbar.newestSnackbarData()?.dismiss()
            snackbar.showSnackbar(message)
        } }
    }
    CompositionLocalProvider(LocalAppSnackbar provides notify) {
        CommunityWorkspace(container, onClose, snackbar)
    }
}

@Composable
private fun CommunityWorkspace(container: AppContainer, onClose: () -> Unit, snackbar: SnackbarHostState) {
    val scope = rememberCoroutineScope()
    val notify = LocalAppSnackbar.current
    val focus = LocalFocusManager.current
    val reduceMotion = LocalEffects.current.reduceMotion
    var posts by remember { mutableStateOf<List<CommunityPost>>(emptyList()) }
    var page by rememberSaveable { mutableIntStateOf(0) }
    var requestedPage by remember { mutableIntStateOf(page) }
    var more by remember { mutableStateOf(false) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var composing by rememberSaveable { mutableStateOf(false) }
    var detail by remember { mutableStateOf<CommunityDetail?>(null) }
    var commentPage by rememberSaveable { mutableIntStateOf(0) }
    var displayedCommentPage by remember { mutableIntStateOf(commentPage) }
    var comment by rememberSaveable(selected) { mutableStateOf("") }
    var pendingCommentId by remember { mutableStateOf<String?>(null) }
    var feedRevision by remember { mutableIntStateOf(0) }
    var feedMutationRevision by remember { mutableIntStateOf(0) }
    var feedMutations by remember { mutableStateOf<Map<String, CommunityFeedMutation>>(emptyMap()) }
    var pendingFeedChanges by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var detailRevision by remember { mutableIntStateOf(0) }
    var reloadAllPages by remember { mutableStateOf(true) }
    var feedLoading by remember { mutableStateOf(true) }
    var detailLoading by remember { mutableStateOf(selected != null) }
    var feedError by remember { mutableStateOf<String?>(null) }
    var detailError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyAction by remember { mutableStateOf<String?>(null) }
    var progress by remember { mutableIntStateOf(0) }
    var preparingImages by remember { mutableStateOf(false) }
    var deletion by remember { mutableStateOf<Pair<String, String>?>(null) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf<List<String>>(emptyList()) }
    var previewVisible by remember { mutableStateOf(false) }
    var previewIndex by remember { mutableIntStateOf(0) }
    val draft = rememberFormDraft(container, "community-post")
    val title = draft.values["title"] as? String ?: ""
    val body = draft.values["body"] as? String ?: ""
    val images = (draft.values["images"] as? List<*>)?.filterIsInstance<String>().orEmpty().distinct().take(3)
    val busy = busyAction != null
    val feedState = rememberAppListState()
    val editorState = rememberAppListState()
    val detailState = rememberAppListState()
    val scrollBehavior = MiuixScrollBehavior()
    val pickerResult: (List<String>) -> Unit = { picked ->
        if (!busy && draft.ready) draft.set("images", (images + picked).distinct().take(3))
    }
    // Fixed contracts let the system picker enforce exactly the remaining capacity.
    val pickThree = rememberImagePicker(3, onProcessingChanged = { preparingImages = it }, onPicked = pickerResult)
    val pickTwo = rememberImagePicker(2, onProcessingChanged = { preparingImages = it }, onPicked = pickerResult)
    val pickOne = rememberImagePicker(1, onProcessingChanged = { preparingImages = it }, onPicked = pickerResult)
    fun refreshFeed() {
        error = null; feedLoading = true; requestedPage = page; reloadAllPages = true; feedRevision++
    }
    fun markFeedChange(id: String, post: CommunityPost? = null) {
        feedMutationRevision++
        pendingFeedChanges = pendingFeedChanges + (id to feedMutationRevision)
        if (post != null) {
            feedMutations = feedMutations + (id to CommunityFeedMutation(feedMutationRevision, post))
            posts = posts.map { if (it.id == id) post else it }
        }
    }
    fun back() {
        if (busyAction != null) return
        focus.clearFocus(); error = null
        when {
            composing -> composing = false // Account/server-scoped DraftStore retains text and images.
            selected != null -> {
                selected = null; pendingCommentId = null
                // Back may cancel the detail read immediately after a successful write.
                if (pendingFeedChanges.isNotEmpty()) refreshFeed()
            }
            else -> onClose()
        }
    }
    fun openPost(id: String) {
        focus.clearFocus(); error = null; commentPage = 0; displayedCommentPage = 0
        pendingCommentId = null
        detailState.requestScrollToItem(0)
        detailLoading = true; detailError = null
        selected = id; composing = false
    }
    fun showPreview(urls: List<String>, index: Int) {
        focus.clearFocus(); preview = urls; previewIndex = index; previewVisible = true
    }
    fun publish() {
        if (busyAction != null || preparingImages || !draft.ready || title.isBlank() || (body.isBlank() && images.isEmpty())) return
        focus.clearFocus()
        busyAction = "publish"; error = null; progress = 0
        scope.launch {
            try {
                when (val result = container.communityRepository.publish(title.trim(), body.trim(), images) { progress = it }) {
                    is ApiResult.Ok -> {
                        val id = result.data.getString("id")
                        markFeedChange(id)
                        draft.clear(); openPost(id)
                        feedState.requestScrollToItem(0); notify("帖子已匿名发布")
                    }
                    is ApiResult.Err -> error = result.message
                }
            } finally { busyAction = null }
        }
    }
    fun sendComment() {
        val id = selected ?: return
        if (busyAction != null || comment.isBlank()) return
        focus.clearFocus()
        busyAction = "comment"; error = null
        scope.launch {
            try {
                when (val result = container.communityRepository.comment(id, comment.trim())) {
                    is ApiResult.Ok -> {
                        comment = ""; pendingCommentId = result.data.getString("id")
                        val current = detail?.takeIf { it.post.id == id }?.post ?: posts.firstOrNull { it.id == id }
                        val updated = current?.copy(commentCount = current.commentCount + 1)
                        markFeedChange(id, updated)
                        if (updated != null && detail?.post?.id == id) detail = detail?.copy(post = updated)
                        detailLoading = true
                        detailRevision++; notify("评论已发布")
                    }
                    is ApiResult.Err -> { error = result.message; notify(result.message) }
                }
            } finally { busyAction = null }
        }
    }
    fun requestDelete(type: String, id: String) { deleteError = null; deletion = type to id }

    // Feed reads belong to the feed, so plain back never drops pages or refetches them.
    // Refresh all loaded pages atomically; a failed page leaves the old list intact.
    LaunchedEffect(feedRevision) {
        feedLoading = true; feedError = null
        val targetPage = requestedPage
        val refreshAll = reloadAllPages
        val startedRevision = feedMutationRevision
        try {
            val refreshed = mutableListOf<CommunityPost>()
            for (nextPage in if (refreshAll) 0..targetPage else targetPage..targetPage) {
                when (val result = container.communityRepository.feed(nextPage)) {
                    is ApiResult.Ok -> {
                        coroutineContext.ensureActive()
                        refreshed += result.data.posts
                        if (nextPage == targetPage || !result.data.hasMore) {
                            posts = mergeCommunityFeedUpdates(if (refreshAll) refreshed else posts + refreshed, feedMutations, startedRevision)
                            if (refreshAll) pendingFeedChanges = pendingFeedChanges.filterValues { it > startedRevision }
                            page = nextPage; more = result.data.hasMore
                            break
                        }
                    }
                    is ApiResult.Err -> { coroutineContext.ensureActive(); feedError = result.message; break }
                }
            }
        } finally { if (coroutineContext[kotlinx.coroutines.Job]?.isActive == true) feedLoading = false }
    }
    // Switching post/page cancels the old read before its response can replace this route.
    LaunchedEffect(selected, commentPage, detailRevision) {
        val id = selected ?: return@LaunchedEffect
        detailLoading = true; detailError = null
        try {
                when (val result = container.communityRepository.detail(id, commentPage)) {
                    is ApiResult.Ok -> {
                        coroutineContext.ensureActive()
                        val newReply = result.data.comments.indexOfFirst { it.id == pendingCommentId }
                        val lastPage = ((result.data.post.commentCount - 1).coerceAtLeast(0)) / 30
                        // Comments are chronological. After sending, find the new reply instead
                        // of returning to page one where it may not be visible.
                        if (commentPage > lastPage || pendingCommentId != null && newReply < 0 && commentPage != lastPage) {
                            commentPage = lastPage
                        } else {
                            val changedPage = displayedCommentPage != commentPage
                            detail = result.data
                            posts = if (posts.any { it.id == id }) posts.map { if (it.id == id) result.data.post else it }
                                else listOf(result.data.post) + posts
                            if (id in pendingFeedChanges) {
                                feedMutationRevision++
                                feedMutations = feedMutations + (id to CommunityFeedMutation(feedMutationRevision, result.data.post))
                                pendingFeedChanges = pendingFeedChanges - id
                            }
                            displayedCommentPage = commentPage
                            detailLoading = false
                            when {
                                newReply >= 0 -> {
                                    pendingCommentId = null
                                    if (reduceMotion) detailState.requestScrollToItem(2 + newReply)
                                    else { withFrameNanos { }; detailState.animateScrollToItem(2 + newReply) }
                                }
                                changedPage -> detailState.requestScrollToItem(1)
                            }
                            if (newReply < 0) pendingCommentId = null
                        }
                    }
                    is ApiResult.Err -> { coroutineContext.ensureActive(); detailError = result.message }
                }
        } finally {
            // An old cancelled read must not dismiss the newer read's indicator.
            if (coroutineContext[kotlinx.coroutines.Job]?.isActive == true) detailLoading = false
        }
    }
    BackHandler { back() }
    val route = if (composing) "editor" else if (selected != null) "detail" else "feed"
    val routeKey = if (route == "detail") "detail:$selected" else route
    AnimatedContent(
        targetState = routeKey, modifier = Modifier.fillMaxSize().clipToBounds(),
        transitionSpec = {
            val direction = if (targetState == "feed") -1 else 1
            val duration = if (reduceMotion) 0 else 240
            (fadeIn(tween(duration, easing = FastOutSlowInEasing)) + slideInHorizontally(tween(duration, easing = FastOutSlowInEasing)) { direction * it / 16 }) togetherWith
                (fadeOut(tween(duration, easing = FastOutSlowInEasing)) + slideOutHorizontally(tween(duration, easing = FastOutSlowInEasing)) { -direction * it / 16 }) using null
        }, label = "community-route",
    ) { destination ->
        val kind = destination.substringBefore(':')
        val active = destination == routeKey
        // The whole page transitions together, including its top bar and comment composer.
        // Snapshot outgoing content so clearing a draft/changing route cannot blank the exit.
        var editorSnapshot by remember { mutableStateOf(Triple(title, body, images)) }
        val matching = detail?.takeIf { it.post.id == destination.substringAfter(':') }
        var detailSnapshot by remember { mutableStateOf(matching) }
        var commentSnapshot by remember { mutableStateOf(comment) }
        var pageSnapshot by remember { mutableIntStateOf(displayedCommentPage) }
        SideEffect {
            if (active && kind == "editor") editorSnapshot = Triple(title, body, images)
            if (matching != null) detailSnapshot = matching
            if (active && kind == "detail") { commentSnapshot = comment; pageSnapshot = displayedCommentPage }
        }
        val editorValues = if (active) Triple(title, body, images) else editorSnapshot
        val article = matching ?: detailSnapshot
        Scaffold(
            // Own blank space too, so taps cannot reach the preserved main tab underneath.
            modifier = Modifier.fillMaxSize().pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent(PointerEventPass.Main)
                }
            },
            snackbarHost = { if (active) SnackbarHost(snackbar, Modifier.imePadding()) },
            topBar = {
                if (kind == "feed") TopAppBar(
                    title = "匿名社区", scrollBehavior = scrollBehavior,
                    navigationIcon = { CommunityBackButton(!active, ::back) },
                    actions = {
                        CommunityRefreshButton(feedLoading, active && !feedLoading, ::refreshFeed)
                        CommunityActionIconButton(onClick = { error = null; editorState.requestScrollToItem(0); composing = true }, enabled = active,
                            backgroundColor = MiuixTheme.colorScheme.primary.copy(alpha = 0.10f)) {
                            Icon(MiuixIcons.Edit, "发布帖子", tint = MiuixTheme.colorScheme.primary)
                        }
                    },
                ) else SmallTopAppBar(
                    title = if (kind == "editor") "发布帖子" else "帖子详情",
                    navigationIcon = { CommunityBackButton(busy || !active, ::back) },
                    actions = {
                        if (kind == "editor") CommunityPublishButton(
                            busy = busyAction == "publish",
                            enabled = active && !busy && !preparingImages && draft.ready && title.isNotBlank() && (body.isNotBlank() || images.isNotEmpty()),
                            onClick = ::publish,
                        ) else {
                            CommunityRefreshButton(detailLoading, active && !detailLoading && !busy, { error = null; detailLoading = true; detailRevision++ })
                            if (article?.post?.canDelete == true) CommunityActionIconButton(
                                onClick = { requestDelete("posts", article.post.id) }, enabled = active && !busy,
                            ) { Icon(MiuixIcons.Delete, "删除帖子") }
                        }
                    },
                )
            },
            bottomBar = {
                if (kind == "detail" && article != null) CommunityCommentBar(
                    value = if (active) comment else commentSnapshot, onChange = { comment = it.take(2000) },
                    busy = busyAction == "comment", enabled = active && !busy, onSend = ::sendComment,
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding), contentAlignment = Alignment.TopCenter) {
                Box(Modifier.widthIn(max = AppSpace.contentWidth).fillMaxSize()) {
                    when (kind) {
                        "editor" -> CommunityEditor(
                            editorValues.first, editorValues.second, editorValues.third, preparingImages, busyAction == "publish",
                            progress, draft.ready && active, if (active) error ?: draft.error else null, editorState,
                            onTitle = { if (active) draft.set("title", it.take(120)) }, onBody = { if (active) draft.set("body", it.take(5000)) },
                            onAdd = { if (active) { focus.clearFocus(); when (3 - images.size) { 3 -> pickThree(); 2 -> pickTwo(); 1 -> pickOne() } } },
                            onRemove = { index -> if (active) draft.set("images", images.filterIndexed { i, _ -> i != index }) },
                            onPreview = { index -> if (active) showPreview(images, index) },
                        )
                        "detail" -> CommunityThread(
                            container, article, active && detailLoading, if (active) error ?: detailError else null,
                            if (active) displayedCommentPage else pageSnapshot, active && !busy, detailState,
                            onRetry = { if (active) { error = null; detailLoading = true; detailRevision++ } },
                            onPage = { if (active) { pendingCommentId = null; commentPage = it; detailLoading = true; detailRevision++ } },
                            onDelete = { type, id -> if (active) requestDelete(type, id) },
                            onPreview = { urls, index -> if (active) showPreview(urls, index) },
                        )
                        else -> CommunityFeedContent(
                            container, posts, active && feedLoading, more, if (active) feedError else null,
                            feedState, Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
                            onRetry = { if (active) refreshFeed() },
                            onCompose = { if (active) { editorState.requestScrollToItem(0); composing = true } },
                            onPost = { if (active) openPost(it) },
                            onMore = { if (active && !feedLoading) { requestedPage = page + 1; reloadAllPages = false; feedRevision++ } },
                        )
                    }
                }
            }
            OverlayDialog(
                show = active && deletion != null, title = "确认删除",
                summary = if (deletion?.first == "posts") "删除后，帖子及其全部评论将无法恢复。" else "删除后，此评论将无法恢复。",
                onDismissRequest = { if (!busy) deletion = null },
            ) {
                deleteError?.let { Text(it, color = MiuixTheme.colorScheme.error, modifier = Modifier.padding(bottom = AppSpace.medium)) }
                Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                    TextButton("取消", modifier = Modifier.weight(1f), enabled = !busy, onClick = { deletion = null })
                    TextButton(if (busyAction == "delete") "删除中…" else "删除", modifier = Modifier.weight(1f),
                        enabled = !busy, colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.error), onClick = {
                            if (busyAction != null) return@TextButton
                            val item = deletion ?: return@TextButton
                            busyAction = "delete"; deleteError = null
                            scope.launch {
                                try {
                                    when (val result = container.communityRepository.remove(item.first, item.second)) {
                                        is ApiResult.Ok -> {
                                            deletion = null
                                            if (item.first == "posts") {
                                                feedMutationRevision++
                                                feedMutations = feedMutations + (item.second to CommunityFeedMutation(feedMutationRevision, null))
                                                pendingFeedChanges = pendingFeedChanges - item.second
                                                posts = posts.filterNot { it.id == item.second }; selected = null; refreshFeed()
                                            } else {
                                                selected?.let { id ->
                                                    val current = detail?.takeIf { it.post.id == id }
                                                    val updated = current?.post?.copy(commentCount = (current.post.commentCount - 1).coerceAtLeast(0))
                                                    markFeedChange(id, updated)
                                                    if (current != null && updated != null) detail = current.copy(
                                                        post = updated, comments = current.comments.filterNot { it.id == item.second },
                                                    )
                                                }
                                                detailLoading = true; detailRevision++
                                            }
                                            notify("已删除")
                                        }
                                        is ApiResult.Err -> deleteError = result.message
                                    }
                                } finally { busyAction = null }
                            }
                        })
                }
            }
        }
    }
    if (preview.isNotEmpty()) CommunityImageViewer(container, preview, previewIndex, visible = previewVisible,
        onDismiss = { previewVisible = false }, onDismissFinished = { preview = emptyList() })
}

@Composable
private fun CommunityBackButton(busy: Boolean, onClick: () -> Unit) {
    CommunityActionIconButton(onClick = onClick, enabled = !busy) { Icon(MiuixIcons.Back, "返回") }
}

