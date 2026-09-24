package com.custodysim.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
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
fun AppShell(container: AppContainer, session: SessionUser, notice: String?,
    onNotice: (String) -> Unit, onLogout: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(MainTab.HOME) }
    var showNotices by rememberSaveable { mutableStateOf(false) }
    var chatConversationTitle by remember { mutableStateOf<String?>(null) }
    var chatBackRequest by remember { mutableIntStateOf(0) }
    var chatRefreshRequest by remember { mutableIntStateOf(0) }
    val stateHolder = rememberSaveableStateHolder()
    BackHandler(tab != MainTab.HOME) { tab = MainTab.HOME }
    // Each tab keeps its own content state through SaveableStateProvider. Do not key the
    // whole scaffold by tab: doing so would recreate AnimatedContent and make transitions
    // appear to snap instead of animating from the previous page.
    val tabScrollBehaviors = MainTab.entries.map { destination -> key(destination) { MiuixScrollBehavior() } }
    val scrollBehavior = tabScrollBehaviors[tab.ordinal]
        Scaffold(
            topBar = {
                TopAppBar(
                    title = if (tab == MainTab.CHAT) chatConversationTitle ?: stringResource(tab.label) else stringResource(tab.label),
                    scrollBehavior = scrollBehavior,
                    navigationIcon = {
                        if (tab == MainTab.CHAT && chatConversationTitle != null) IconButton(
                            onClick = { chatBackRequest++ }) {
                            Icon(MiuixIcons.Basic.ArrowRight,
                                contentDescription = stringResource(R.string.back_to_list),
                                modifier = Modifier.graphicsLayer { rotationZ = 180f })
                        }
                    },
                    actions = {
                        if (tab == MainTab.HOME) {
                            IconButton(onClick = { showNotices = true }) {
                                Icon(MiuixIcons.Promotions, contentDescription = stringResource(R.string.portal_notices), tint = MiuixTheme.colorScheme.primary)
                            }
                        }
                        if (tab == MainTab.CHAT && chatConversationTitle != null) IconButton(
                            onClick = { chatRefreshRequest++ }) {
                            Icon(MiuixIcons.Refresh, contentDescription = stringResource(R.string.refresh))
                        }
                    },
                )
            },
            bottomBar = {
                NavigationBar {
                    MainTab.entries.forEach { destination ->
                        NavigationBarItem(
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
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding),
                contentAlignment = Alignment.TopCenter) {
                Box(Modifier.widthIn(max = AppSpace.contentWidth).fillMaxSize()) {
                    AnimatedContent(
                        modifier = Modifier.fillMaxSize(),
                        targetState = tab,
                        transitionSpec = {
                            val direction = if (targetState.ordinal > initialState.ordinal) 1 else -1
                            (fadeIn(animationSpec = androidx.compose.animation.core.tween(320)) +
                                slideInHorizontally(
                                    animationSpec = androidx.compose.animation.core.tween(320),
                                    initialOffsetX = { direction * it / 8 },
                                )) togetherWith
                                (fadeOut(animationSpec = androidx.compose.animation.core.tween(220)) +
                                    slideOutHorizontally(
                                        animationSpec = androidx.compose.animation.core.tween(220),
                                        targetOffsetX = { -direction * it / 8 },
                                    )) using SizeTransform(clip = true)
                        },
                        label = "main-tab-transition",
                    ) { destination ->
                    stateHolder.SaveableStateProvider(destination.name) {
                        val scrollBehavior = tabScrollBehaviors[destination.ordinal]
                        when (destination) {
                            MainTab.HOME -> HomeScreen(container, session, notice, onNotice, scrollBehavior)
                            MainTab.CHECKINS -> CheckinsScreen(container, scrollBehavior)
                            MainTab.TASKS -> TasksScreen(container, scrollBehavior)
                            MainTab.APPLICATIONS -> ApplicationsScreen(container, scrollBehavior)
                            MainTab.CHAT -> ChatScreen(container, session, scrollBehavior,
                                onConversationChanged = { chatConversationTitle = it },
                                backRequest = chatBackRequest, refreshRequest = chatRefreshRequest)
                            MainTab.MINE -> MineScreen(container, session, onLogout, scrollBehavior)
                        }
                    }
                    }
                }
                NoticeSheet(container, showNotices) { showNotices = false }
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
private fun MineScreen(container: AppContainer, session: SessionUser, onLogout: () -> Unit, scrollBehavior: ScrollBehavior) {
    val context = LocalContext.current
    val appearance = LocalAppearance.current
    val haptics = LocalHapticFeedback.current
    var locationEnabled by remember { mutableStateOf(LocationPreferences.isEnabled(context)) }
    var locationInterval by remember { mutableLongStateOf(LocationPreferences.intervalMinutes(context)) }
    var serverPolicy by remember { mutableStateOf<LocationPolicy?>(null) }
    LaunchedEffect(Unit) { serverPolicy = container.locationRepository.fetchPolicy() }
    val intervals = remember(serverPolicy) {
        val policy = serverPolicy ?: LocationPolicy.FALLBACK
        val min = ((policy.minIntervalSeconds + 59) / 60).coerceAtLeast(15)
        val max = (policy.maxIntervalSeconds / 60).coerceAtMost(360)
        (15L..360L step 15L).filter { it >= min && it <= max }.ifEmpty { listOf(min.toLong().coerceAtMost(360L)) }
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
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = PaddingValues(AppSpace.page),
        verticalArrangement = Arrangement.spacedBy(AppSpace.medium),
    ) {
        item {
            Row(Modifier.padding(AppSpace.inset), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AppSpace.page)) {
                Icon(MiuixIcons.Contacts, null, modifier = Modifier.size(AppSpace.large),
                    tint = MiuixTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text(session.name, style = MiuixTheme.textStyles.title2)
                    Text(roleLabel(session.role), color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
            }
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
                            if (enabled) LocationScheduler.ensurePeriodic(context) else LocationScheduler.cancel(context)
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        })
                    OverlaySpinnerPreference(
                        title = stringResource(R.string.location_interval_label),
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
                SettingGroup { InfoRow(stringResource(R.string.version), BuildConfig.VERSION_NAME) }
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
