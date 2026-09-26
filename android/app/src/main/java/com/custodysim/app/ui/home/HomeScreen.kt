package com.custodysim.app.ui.home

import androidx.core.net.toUri
import androidx.core.content.edit
import android.Manifest
import android.os.Build
import android.content.Intent
import android.provider.Settings
import androidx.compose.ui.platform.LocalResources
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.roleLabel
import com.custodysim.app.ui.theme.*
import com.custodysim.app.location.LocationPreferences
import com.custodysim.app.location.LocationNotifications
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun HomeScreen(container: AppContainer, session: SessionUser, scrollBehavior: ScrollBehavior) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val snackbar = LocalAppSnackbar.current
    val automaticLocationStatus by container.locationReporting.status.collectAsStateWithLifecycle()
    var queued by remember { mutableIntStateOf(0) }
    var reporting by remember { mutableStateOf(false) }
    var notificationsEnabled by remember { mutableStateOf(LocationNotifications.enabled(context)) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationsEnabled = LocationNotifications.enabled(context)
    }
    var intervalMinutes by remember { mutableLongStateOf(LocationPreferences.intervalMinutes(context)) }
    var hasForeground by remember { mutableStateOf(container.locationCollector.hasForegroundPermission()) }
    var hasBackground by remember { mutableStateOf((Build.VERSION.SDK_INT < 29 && container.locationCollector.hasForegroundPermission()) || container.locationCollector.hasBackgroundPermission()) }
    fun refreshPermissions() {
        hasForeground = container.locationCollector.hasForegroundPermission()
        hasBackground = container.locationCollector.hasBackgroundPermission()
    }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                refreshPermissions()
                notificationsEnabled = LocationNotifications.enabled(context)
                intervalMinutes = LocationPreferences.intervalMinutes(context)
                scope.launch { queued = container.pendingPointStore.size() }
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        refreshPermissions()
    }
    suspend fun refresh() {
        queued = container.pendingPointStore.size()
    }
    fun uploadPending(collectLocation: Boolean) {
        if (reporting) return
        reporting = true
        scope.launch {
            try {
                if (collectLocation) {
                    snackbar(resources.getString(R.string.locating))
                    val point = container.locationCollector.collectOnce()
                    if (point == null) {
                        snackbar(resources.getString(R.string.location_failed))
                        return@launch
                    }
                    container.pendingPointStore.append(listOf(point))
                }
                val policy = container.locationRepository.fetchPolicy()
                container.pendingPointStore.pruneExpired(policy.maxReportAgeSeconds)
                when (val result = container.locationUploader.upload(policy.maxPointsPerBatch)) {
                    is ApiResult.Ok -> snackbar(resources.getString(R.string.report_success,
                        result.data.accepted, result.data.skipped))
                    is ApiResult.Err -> snackbar(resources.getString(R.string.report_failed, result.message))
                }
                refresh()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                snackbar(resources.getString(R.string.report_failed, error.message ?: "无法读取或保存定位数据"))
            } finally {
                reporting = false
            }
        }
    }
    LaunchedEffect(automaticLocationStatus) { refresh() }

    LazyColumn(
        state = rememberAppListState(),
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = glassPagePadding(),
        verticalArrangement = Arrangement.spacedBy(AppSpace.page),
    ) {
        item {
            Column(Modifier.padding(horizontal = AppSpace.inset, vertical = AppSpace.small)) {
                Text(session.name, style = MiuixTheme.textStyles.title2)
                Text(roleLabel(session.role), style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
        }
        if (session.mustChangePassword) item { NoticeBanner(stringResource(R.string.password_notice), error = true) }
        item {
            val status = when {
                !session.isSupervised -> R.string.location_not_required
                hasForeground -> R.string.location_ready
                else -> R.string.location_needs_permission
            }
            Card(modifier = Modifier.fillMaxWidth(), cornerRadius = AppShape.group,
                insideMargin = PaddingValues(AppSpace.inset),
                colors = CardDefaults.defaultColors(
                    color = MiuixTheme.colorScheme.primary.copy(alpha = 0.10f))) {
                Text(stringResource(R.string.location), style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.primary)
                Spacer(Modifier.height(AppSpace.small))
                Text(stringResource(status), style = MiuixTheme.textStyles.title2)
                Spacer(Modifier.height(AppSpace.small))
                Text(stringResource(when {
                    !session.isSupervised -> R.string.location_role_hint
                    hasForeground -> R.string.location_ready_hint
                    else -> R.string.location_permission_hint
                }), style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
        }
        if (session.isSupervised) {
            item {
                PrimaryAction(stringResource(if (reporting) R.string.report_busy else R.string.report_now),
                    busy = reporting, onClick = {
                        if (reporting) return@PrimaryAction
                        if (!hasForeground) {
                            permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION))
                            snackbar(resources.getString(R.string.grant_location))
                        } else {
                            uploadPending(collectLocation = true)
                        }
                    })
            }
            item {
                Column {
                    SectionTitle(stringResource(R.string.location))
                    SettingGroup {
                        BasicComponent(title = "自动上报状态", summary = automaticLocationStatus)
                        if (!notificationsEnabled) BasicComponent(
                            title = stringResource(R.string.location_notification_settings),
                            summary = stringResource(R.string.location_notification_hint),
                            onClick = {
                                val prefs = context.getSharedPreferences("location_notifications", android.content.Context.MODE_PRIVATE)
                                if (Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("requested", false)) {
                                    prefs.edit { putBoolean("requested", true) }
                                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                } else {
                                    context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                                }
                            },
                        )
                        BasicComponent(title = stringResource(R.string.location_queue), endActions = {
                            Text(stringResource(R.string.location_queue_count, queued),
                                style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                        })
                        if (queued > 0) TextButton(
                            text = stringResource(R.string.location_retry_pending),
                            enabled = !reporting,
                            onClick = { uploadPending(collectLocation = false) },
                            modifier = Modifier.fillMaxWidth().padding(horizontal = AppSpace.inset),
                            colors = ButtonDefaults.textButtonColors(textColor = MiuixTheme.colorScheme.primary),
                        )
                        BasicComponent(title = stringResource(R.string.location_interval_label), endActions = {
                            Text(stringResource(R.string.location_interval_option, intervalMinutes),
                                style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.primary)
                        })
                    }
                }
            }
            item {
                Column {
                    SectionTitle(stringResource(R.string.location_permissions))
                    SettingGroup {
                        BasicComponent(title = stringResource(R.string.foreground_permission), endActions = {
                            StatusChip(stringResource(if (hasForeground) R.string.granted else R.string.not_granted),
                                if (hasForeground) AppColors.success else AppColors.warning)
                        })
                        BasicComponent(title = stringResource(R.string.background_permission), endActions = {
                            StatusChip(stringResource(if (hasBackground) R.string.granted else R.string.not_granted),
                                if (hasBackground) AppColors.success else AppColors.warning)
                        })
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= 29 && hasForeground && !hasBackground) item {
                TextButton(text = stringResource(R.string.grant_background),
                    modifier = Modifier.fillMaxWidth(), onClick = {
                        if (Build.VERSION.SDK_INT >= 30) {
                            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                "package:${context.packageName}".toUri()))
                        } else {
                            permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                        }
                        snackbar(resources.getString(R.string.background_hint))
                    })
            }
        }
    }
}
