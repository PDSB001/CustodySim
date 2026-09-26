package com.custodysim.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.res.stringResource
import com.custodysim.app.AppContainer
import com.custodysim.app.BuildConfig
import com.custodysim.app.R
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.ui.checkins.CheckinsScreen
import com.custodysim.app.ui.home.HomeScreen
import com.custodysim.app.ui.tasks.TasksScreen
import com.custodysim.app.ui.mine.AccountHub
import com.custodysim.app.ui.mine.NoticeSheet
import com.custodysim.app.ui.applications.ApplicationsScreen
import com.custodysim.app.ui.chat.ChatScreen
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import com.custodysim.app.location.LocationPreferences
import com.custodysim.app.location.LocationScheduler
import com.custodysim.app.data.location.LocationPolicy
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Contacts
import top.yukonga.miuix.kmp.icon.extended.Home
import top.yukonga.miuix.kmp.icon.extended.Messages
import top.yukonga.miuix.kmp.icon.extended.Promotions
import top.yukonga.miuix.kmp.icon.extended.Notes
import top.yukonga.miuix.kmp.icon.extended.Recent
import top.yukonga.miuix.kmp.icon.extended.Tasks
import top.yukonga.miuix.kmp.icon.extended.Refresh
import top.yukonga.miuix.kmp.icon.basic.ArrowRight
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.preference.*
import top.yukonga.miuix.kmp.basic.DropdownItem
import top.yukonga.miuix.kmp.theme.MiuixTheme

enum class MainTab(val label: Int) {
    HOME(R.string.home), CHECKINS(R.string.checkins), TASKS(R.string.tasks), APPLICATIONS(R.string.portal_applications), CHAT(R.string.chat), MINE(R.string.mine)
}

@Composable
fun AppShell(container: AppContainer, session: SessionUser, onLogout: () -> Unit, onServerSettings: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(MainTab.HOME) }
    var showNotices by rememberSaveable { mutableStateOf(false) }
    var chatConversationTitle by remember { mutableStateOf<String?>(null) }
    var chatBackRequest by remember { mutableIntStateOf(0) }
    var chatRefreshRequest by remember { mutableIntStateOf(0) }
    val stateHolder = rememberSaveableStateHolder()
    val snackbarState = remember { SnackbarHostState() }
    val snackbarScope = rememberCoroutineScope()
    val showSnackbar: (String) -> Unit = remember(snackbarState, snackbarScope) {
        { message -> snackbarScope.launch {
            snackbarState.newestSnackbarData()?.dismiss()
            snackbarState.showSnackbar(message)
        } }
    }
    BackHandler(tab != MainTab.HOME) { tab = MainTab.HOME }
    // Each tab keeps its own content state through SaveableStateProvider. Do not key the
    // whole scaffold by tab: doing so would recreate AnimatedContent and make transitions
    // appear to snap instead of animating from the previous page.
    val tabScrollBehaviors = MainTab.entries.map { destination -> key(destination) { MiuixScrollBehavior() } }
    val scrollBehavior = tabScrollBehaviors[tab.ordinal]
    val inConversation = tab == MainTab.CHAT && chatConversationTitle != null
    val effects = LocalEffects.current
    val backdrop = rememberGlassBackdrop()
    val extendUnderNavigation = !inConversation && effects.effectiveLevel != EffectsLevel.OFF
    CompositionLocalProvider(LocalAppSnackbar provides showSnackbar, LocalDraftOwner provides session.id,
            LocalGlassBackdrop provides backdrop) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarState, Modifier.imePadding()) },
            topBar = {
                GlassSurface(cornerRadius = 0.dp, enableRefraction = false) {
                if (inConversation) {
                    SmallTopAppBar(
                        color = Color.Transparent,
                        title = chatConversationTitle.orEmpty(),
                        navigationIcon = {
                            IconButton(onClick = { chatBackRequest++ }) {
                                Icon(MiuixIcons.Basic.ArrowRight,
                                    contentDescription = stringResource(R.string.back_to_list),
                                    modifier = Modifier.graphicsLayer { rotationZ = 180f })
                            }
                        },
                        actions = {
                            IconButton(onClick = { chatRefreshRequest++ }) {
                                Icon(MiuixIcons.Refresh, contentDescription = stringResource(R.string.refresh))
                            }
                        },
                    )
                } else {
                TopAppBar(
                    color = Color.Transparent,
                    title = stringResource(tab.label),
                    scrollBehavior = scrollBehavior,
                    actions = {
                        if (tab == MainTab.HOME) {
                            IconButton(onClick = { showNotices = true }) {
                                Icon(MiuixIcons.Promotions, contentDescription = stringResource(R.string.portal_notices), tint = MiuixTheme.colorScheme.primary)
                            }
                        }
                    },
                )
                }
                }
            },
            bottomBar = {
                AnimatedVisibility(
                    visible = !inConversation,
                    // Keep the bar's measured size during exit; animate its layer instead of
                    // squeezing the icons into a rapidly shrinking strip.
                    enter = fadeIn(tween(if (effects.reduceMotion) 0 else 360, easing = FastOutSlowInEasing)) +
                        slideInVertically(tween(if (effects.reduceMotion) 0 else 360, easing = FastOutSlowInEasing)) { it / 2 },
                    exit = fadeOut(tween(if (effects.reduceMotion) 0 else 360, easing = FastOutSlowInEasing)) +
                        slideOutVertically(tween(if (effects.reduceMotion) 0 else 360, easing = FastOutSlowInEasing)) { it / 2 },
                ) {
                val glassEnabled = effects.effectiveLevel != EffectsLevel.OFF
                Box(Modifier.padding(
                    horizontal = if (glassEnabled) AppSpace.small else 0.dp,
                ).padding(
                    top = if (glassEnabled) AppSpace.small else 0.dp,
                    bottom = if (glassEnabled) WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + AppSpace.small else 0.dp,
                )) {
                GlassSurface {
                GlassTabIndicator(selectedIndex = tab.ordinal, count = MainTab.entries.size)
                NavigationBar(color = Color.Transparent, showDivider = !glassEnabled,
                    defaultWindowInsetsPadding = !glassEnabled) {
                    MainTab.entries.forEach { destination ->
                        NavigationBarItem(
                            // Miuix anchors icon+label at the top of its 64dp cell. Balance the
                            // remaining label space inside the floating glass surface.
                            modifier = Modifier.offset(y = if (glassEnabled) 3.dp else 0.dp),
                            selected = tab == destination, onClick = { tab = destination },
                            icon = when (destination) {
                                MainTab.HOME -> MiuixIcons.Home
                                MainTab.CHECKINS -> MiuixIcons.Recent
                                MainTab.TASKS -> MiuixIcons.Notes
                                MainTab.APPLICATIONS -> MiuixIcons.Tasks
                                MainTab.CHAT -> MiuixIcons.Messages
                                MainTab.MINE -> MiuixIcons.Contacts
                            }, label = if (destination == MainTab.APPLICATIONS) "申请" else stringResource(destination.label),
                        )
                    }
                }
                }
                }
                }
            },
        ) { padding ->
            CompositionLocalProvider(
                LocalGlassPageBottomInset provides if (extendUnderNavigation) padding.calculateBottomPadding() else 0.dp,
                LocalGlassPageTopInset provides if (extendUnderNavigation) padding.calculateTopPadding() else 0.dp,
            ) {
            val direction = LocalLayoutDirection.current
            val pagePadding = PaddingValues(start = padding.calculateStartPadding(direction),
                end = padding.calculateEndPadding(direction), top = if (extendUnderNavigation) 0.dp else padding.calculateTopPadding(),
                bottom = if (extendUnderNavigation || inConversation) 0.dp else padding.calculateBottomPadding())
            // The conversation owns its IME/navigation insets. The departing tab bar must not
            // resize its composer or consume a changing portion of the navigation inset.
            val consumedPadding = if (inConversation) PaddingValues(top = padding.calculateTopPadding()) else padding
            Box(Modifier.fillMaxSize().padding(pagePadding).consumeWindowInsets(consumedPadding),
                contentAlignment = Alignment.TopCenter) {
                Box(Modifier.widthIn(max = AppSpace.contentWidth).fillMaxSize().glassBackdropSource(backdrop)) {
                    AnimatedContent(
                        modifier = Modifier.fillMaxSize().clipToBounds(),
                        targetState = tab,
                        transitionSpec = {
                            val direction = if (targetState.ordinal > initialState.ordinal) 1 else -1
                            // 与 AppRoot（登录 ↔ 主壳）、聊天「列表 ↔ 会话」同一套：小幅位移 + 淡入淡出，
                            // 都用默认 spring，两端自然减速。位移与淡入若配不同的显式 tween（淡入先结束、
                            // 位移还在跑），后半程只剩"裸滑动"，观感又快又硬。
                            (fadeIn() + slideInHorizontally { direction * it / 8 }) togetherWith
                                (fadeOut() + slideOutHorizontally { -direction * it / 8 }) using null
                        },
                        label = "main-tab-transition",
                    ) { destination ->
                    stateHolder.SaveableStateProvider(destination.name) {
                        val scrollBehavior = tabScrollBehaviors[destination.ordinal]
                        when (destination) {
                            MainTab.HOME -> HomeScreen(container, session, scrollBehavior)
                            MainTab.CHECKINS -> CheckinsScreen(container, scrollBehavior)
                            MainTab.TASKS -> TasksScreen(container, scrollBehavior)
                            MainTab.APPLICATIONS -> ApplicationsScreen(container, scrollBehavior)
                            MainTab.CHAT -> ChatScreen(container, session, scrollBehavior,
                                conversationLayoutReady = inConversation,
                                onConversationChanged = { chatConversationTitle = it },
                                backRequest = chatBackRequest, refreshRequest = chatRefreshRequest)
                            MainTab.MINE -> MineScreen(container, session, onLogout, scrollBehavior, onServerSettings)
                        }
                    }
                    }
                }
                NoticeSheet(container, showNotices) { showNotices = false }
            }
            }
        }
    }

}

@Composable
fun roleLabel(role: String): String = when (role) {
    "ADMIN" -> stringResource(R.string.role_admin)
    "SUPERVISOR" -> stringResource(R.string.role_supervisor)
    "SUPERVISED" -> stringResource(R.string.role_supervised)
    else -> role
}

@Composable
private fun MineScreen(container: AppContainer, session: SessionUser, onLogout: () -> Unit, scrollBehavior: ScrollBehavior, onServerSettings: () -> Unit) {
    val context = LocalContext.current
    val appearance = LocalAppearance.current
    val haptics = LocalHapticFeedback.current
    var locationEnabled by remember { mutableStateOf(LocationPreferences.isEnabled(context)) }
    var locationInterval by remember { mutableLongStateOf(LocationPreferences.intervalMinutes(context)) }
    var serverPolicy by remember { mutableStateOf<LocationPolicy?>(null) }
    LaunchedEffect(Unit) { serverPolicy = container.locationRepository.fetchPolicy() }
    val intervals = remember(serverPolicy) {
        val policy = serverPolicy ?: LocationPolicy.FALLBACK
        val min = ((policy.minIntervalSeconds + 59) / 60).coerceAtLeast(5)
        val max = (policy.maxIntervalSeconds / 60).coerceAtMost(360)
        LocationPreferences.intervals.filter { it >= min && it <= max }.ifEmpty { listOf(min.toLong().coerceAtMost(360L)) }
    }
    LaunchedEffect(intervals) {
        if (locationInterval !in intervals) {
            locationInterval = intervals.first()
            LocationPreferences.setIntervalMinutes(context, locationInterval)
            if (locationEnabled) LocationScheduler.reschedule(context, locationInterval)
        }
    }
    var showLogout by remember { mutableStateOf(false) }
    BackHandler(showLogout) { showLogout = false }
    LazyColumn(
        state = rememberAppListState(),
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = glassPagePadding(),
        verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
    ) {
        item {
            com.custodysim.app.ui.mine.AvatarAccountHeader(container, session)
        }
        if (session.mustChangePassword) item { NoticeBanner(stringResource(R.string.password_notice), error = true) }
        item {
            Column {
                SectionTitle(stringResource(R.string.account))
                SettingGroup {
                    InfoRow(stringResource(R.string.username), session.username)
                    InfoRow(stringResource(R.string.role), roleLabel(session.role))
                }
            }
        }
        item {
            Column {
                SectionTitle(stringResource(R.string.appearance))
                SettingGroup {
                    Appearance.entries.forEach { value ->
                        val label = stringResource(when (value) {
                            Appearance.SYSTEM -> R.string.appearance_system
                            Appearance.LIGHT -> R.string.appearance_light
                            Appearance.DARK -> R.string.appearance_dark
                        })
                        RadioButtonPreference(title = label, selected = appearance.mode == value,
                            radioButtonLocation = RadioButtonLocation.End,
                            onClick = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                appearance.select(value)
                            })
                    }
                }
            }
        }
        item { EffectsPreferences() }
        item {
            Column {
                SectionTitle(stringResource(R.string.location_settings))
                SettingGroup {
                    SwitchPreference(
                        title = stringResource(R.string.location_reporting),
                        summary = stringResource(if (locationEnabled) R.string.location_reporting_enabled else R.string.location_reporting_disabled),
                        checked = locationEnabled, onCheckedChange = { enabled ->
                            locationEnabled = enabled
                            LocationPreferences.setEnabled(context, enabled)
                            if (enabled) {
                                LocationScheduler.ensurePeriodic(context)
                                com.custodysim.app.location.LocationIntervalService.sync(context)
                            } else LocationScheduler.cancel(context)
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        })
                    OverlaySpinnerPreference(
                        title = stringResource(R.string.location_interval_label),
                        summary = stringResource(R.string.location_short_hint),
                        items = intervals.map { minutes ->
                            DropdownItem(text = stringResource(R.string.location_interval_option, minutes))
                        },
                        selectedIndex = intervals.indexOf(locationInterval).coerceAtLeast(0),
                        enabled = locationEnabled,
                        onSelectedIndexChange = { index ->
                            val minutes = intervals[index]
                            locationInterval = minutes
                            LocationPreferences.setIntervalMinutes(context, minutes)
                            if (locationEnabled) LocationScheduler.reschedule(context, minutes)
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        item {
            Column {
                SectionTitle(stringResource(R.string.about))
                SettingGroup {
                    BasicComponent(title = "服务器设置", onClick = onServerSettings)
                    InfoRow(stringResource(R.string.version), BuildConfig.VERSION_NAME)
                }
            }
        }
        item { AccountHub(container, session.isSupervised) }
        item {
            TextButton(text = stringResource(R.string.logout), onClick = { showLogout = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.error))
        }
    }
    OverlayDialog(
        show = showLogout, title = stringResource(R.string.logout),
        summary = stringResource(R.string.logout_summary),
        onDismissRequest = { showLogout = false },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
            TextButton(text = stringResource(R.string.logout), modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.textButtonColorsPrimary(
                    color = MiuixTheme.colorScheme.error, textColor = MiuixTheme.colorScheme.onError),
                onClick = {
                    showLogout = false
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onLogout()
                })
            TextButton(text = stringResource(R.string.cancel), onClick = { showLogout = false },
                modifier = Modifier.fillMaxWidth())
        }
    }
}
