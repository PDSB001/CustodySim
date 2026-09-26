package com.custodysim.app.ui

import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import android.os.SystemClock
import kotlinx.coroutines.delay
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.auth.LoginOutcome
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.location.LocationScheduler
import com.custodysim.app.ui.login.LoginScreen
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.custodysim.app.R
import com.custodysim.app.ui.common.PageState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.isActive

/**
 * 应用根：只负责"未登录 / 登录中 / 已登录"这三种状态之间的切换。
 *
 * 会话失效（令牌过期且刷新失败）由 [AppContainer] 回调过来，这里把界面切回登录页 ——
 * 这是唯一会把用户踢出登录态的路径。
 */
@Composable
fun AppRoot(container: AppContainer, onServerSettings: () -> Unit) {
    if (container.endpoint.baseUrl.isBlank()) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.layout.Column {
                PageState("欢迎使用 CustodySim，请先设置服务器地址")
                top.yukonga.miuix.kmp.basic.TextButton(text = "设置服务器", onClick = onServerSettings)
            }
        }
        return
    }
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()

    var restored by remember { mutableStateOf(false) }
    var session by remember { mutableStateOf<SessionUser?>(null) }
    var mfaToken by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var noticeIsError by remember { mutableStateOf(false) }
    var retryAt by rememberSaveable { mutableLongStateOf(0L) }
    var retrySeconds by remember { mutableLongStateOf(0L) }
    LaunchedEffect(retryAt) {
        do {
            retrySeconds = ((retryAt - SystemClock.elapsedRealtime() + 999) / 1000).coerceAtLeast(0)
            if (retrySeconds > 0) delay(250)
        } while (retrySeconds > 0)
    }
    fun showAuthError(result: ApiResult.Err) {
        notice = result.message
        noticeIsError = true
        if (result.httpStatus == 429) {
            retryAt = SystemClock.elapsedRealtime() + (result.retryAfterSeconds ?: 60L) * 1000
        }
    }

    LaunchedEffect(Unit) {
        // First-use OkHttp/TLS and Keystore initialization must not block startup frames.
        session = withContext(Dispatchers.IO) { container.authRepository.restoreSession() }
        restored = true
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(session?.id, lifecycleOwner) {
        val activeSession = session ?: return@LaunchedEffect
        container.locationReporting.setEligible(activeSession.isSupervised)
        if (!activeSession.isSupervised) {
            LocationScheduler.cancel(context)
            return@LaunchedEffect
        }
        LocationScheduler.ensurePeriodic(context)
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                container.locationReporting.collectIfDue(foreground = true, startup = true)
                com.custodysim.app.location.LocationIntervalService.sync(context)
                delay(60_000)
            }
        }
    }

    DisposableEffect(Unit) {
        container.observeSessionLoss {
            container.locationReporting.setEligible(false)
            LocationScheduler.cancel(context)
            session = null
            mfaToken = null
            notice = resources.getString(R.string.session_expired)
            noticeIsError = true
        }
        onDispose { container.observeSessionLoss(null) }
    }

    val rootMode = when {
        !restored -> 0
        session == null -> 1
        else -> 2
    }
    AnimatedContent(
        targetState = rootMode,
        transitionSpec = {
            (fadeIn() + slideInHorizontally { it / 8 }) togetherWith
                (fadeOut() + slideOutHorizontally { -it / 8 })
        },
        label = "root-state-transition",
    ) { mode ->
        when (mode) {
            0 -> Box(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), contentAlignment = Alignment.Center) {
                PageState(stringResource(R.string.restoring), loading = true)
            }

            1 -> LoginScreen(
                    onServerSettings = onServerSettings,
                    busy = busy,
                    retrySeconds = retrySeconds,
                    mfaRequired = mfaToken != null,
                    notice = notice,
                    noticeIsError = noticeIsError,
                    onCancelMfa = { mfaToken = null; notice = null; noticeIsError = false },
                    onSubmit = { username, password ->
                        if (busy || SystemClock.elapsedRealtime() < retryAt) return@LoginScreen
                        busy = true
                        scope.launch {
                            try {
                            notice = null
                            noticeIsError = false
                            when (val result = container.authRepository.login(username, password)) {
                                is ApiResult.Ok -> when (val outcome = result.data) {
                                    is LoginOutcome.Session -> {
                                        session = outcome.user
                                        mfaToken = null
                                    }

                                    is LoginOutcome.MfaRequired -> {
                                        mfaToken = outcome.mfaToken
                                        notice = resources.getString(R.string.mfa_intro)
                                    }
                                }

                                is ApiResult.Err -> showAuthError(result)
                            }
                            } finally { busy = false }
                        }
                    },
                    onVerifyMfa = { code, trustDevice ->
                        val challenge = mfaToken ?: return@LoginScreen
                        if (busy || SystemClock.elapsedRealtime() < retryAt) return@LoginScreen
                        busy = true
                        scope.launch {
                            try {
                            notice = null
                            when (
                                val result = container.authRepository
                                    .verifyMfa(code, trustDevice, challenge)
                            ) {
                                is ApiResult.Ok -> {
                                    session = result.data
                                    mfaToken = null
                                }

                                is ApiResult.Err -> showAuthError(result)
                            }
                            } finally { busy = false }
                        }
                    },
                )

            else -> AppShell(
                    onServerSettings = onServerSettings,
                    container = container,
                    session = session!!,
                    onLogout = {
                        scope.launch {
                            container.authRepository.logout()
                            container.locationReporting.setEligible(false)
                            LocationScheduler.cancel(context)
                            session = null
                            notice = resources.getString(R.string.logged_out)
                            noticeIsError = false
                        }
                    },
                )
        }
    }
}
