package com.custodysim.app.ui.home

import android.Manifest
import android.os.Build
import android.content.Intent
import android.net.Uri
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
import com.custodysim.app.AppContainer
import com.custodysim.app.R
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.roleLabel
import com.custodysim.app.ui.theme.*
import com.custodysim.app.location.LocationPreferences
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun HomeScreen(container: AppContainer, session: SessionUser, notice: String?,
    onNotice: (String) -> Unit, scrollBehavior: ScrollBehavior) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    var queued by remember { mutableIntStateOf(0) }
    var reporting by remember { mutableStateOf(false) }
    var hasForeground by remember { mutableStateOf(container.locationCollector.hasForegroundPermission()) }
    var hasBackground by remember { mutableStateOf((Build.VERSION.SDK_INT < 29 && container.locationCollector.hasForegroundPermission()) || container.locationCollector.hasBackgroundPermission()) }
    fun refreshPermissions() {
        hasForeground = container.locationCollector.hasForegroundPermission()
        hasBackground = container.locationCollector.hasBackgroundPermission()
    }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshPermissions()
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
    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = PaddingValues(AppSpace.page),
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
                Column {
                    SectionTitle(stringResource(R.string.location_queue))
                    SettingGroup {
                        InfoRow(stringResource(R.string.location_queue), stringResource(R.string.location_queue_count, queued))
                        InfoRow(stringResource(R.string.location_interval_label), stringResource(R.string.location_interval, LocationPreferences.intervalMinutes(context)))
                    }
                }
            }
            item {
                Column {
                    SectionTitle(stringResource(R.string.location_permissions))
                    SettingGroup {
                        InfoRow(stringResource(R.string.foreground_permission),
                            stringResource(if (hasForeground) R.string.granted else R.string.not_granted))
                        InfoRow(stringResource(R.string.background_permission),
                            stringResource(if (hasBackground) R.string.granted else R.string.not_granted))
                    }
                }
            }
            item {
                PrimaryAction(stringResource(if (reporting) R.string.report_busy else R.string.report_now),
                    busy = reporting, onClick = {
                        if (!hasForeground) {
                            permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION))
                            onNotice(resources.getString(R.string.grant_location))
                        } else {
                            scope.launch {
                                reporting = true
                                try {
                                    onNotice(resources.getString(R.string.locating))
                                    val point = container.locationCollector.collectOnce()
                                    if (point == null) {
                                        onNotice(resources.getString(R.string.location_failed))
                                        return@launch
                                    }
                                    container.pendingPointStore.append(listOf(point))
                                    when (val result = container.locationRepository.reportBatch(listOf(point))) {
                                        is ApiResult.Ok -> onNotice(resources.getString(R.string.report_success,
                                            result.data.accepted, result.data.skipped))
                                        is ApiResult.Err -> onNotice(resources.getString(R.string.report_failed, result.message))
                                    }
                                    refresh()
                                } finally { reporting = false }
                            }
                        }
                    })
            }
            if (Build.VERSION.SDK_INT >= 29 && hasForeground && !hasBackground) item {
                TextButton(text = stringResource(R.string.grant_background),
                    modifier = Modifier.fillMaxWidth(), onClick = {
                        if (Build.VERSION.SDK_INT >= 30) {
                            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + context.packageName)))
                        } else {
                            permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                        }
                        onNotice(resources.getString(R.string.background_hint))
                    })
            }
        }
        notice?.let { item { SettingGroup { NoticeBanner(it) } } }
    }
}
