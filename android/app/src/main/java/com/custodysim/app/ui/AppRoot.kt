package com.custodysim.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import top.yukonga.miuix.kmp.basic.Text
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

/**
 * 应用根：只负责"未登录 / 登录中 / 已登录"这三种状态之间的切换。
 *
 * 会话失效（令牌过期且刷新失败）由 [AppContainer] 回调过来，这里把界面切回登录页 ——
 * 这是唯一会把用户踢出登录态的路径。
 */
@Composable
fun AppRoot(container: AppContainer) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()

    var restored by remember { mutableStateOf(false) }
    var session by remember { mutableStateOf<SessionUser?>(null) }
    var mfaToken by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var noticeIsError by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        session = container.authRepository.restoreSession()
        restored = true
        if (session != null) LocationScheduler.ensurePeriodic(context)
    }

    DisposableEffect(Unit) {
        container.observeSessionLoss {
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
                    busy = busy,
                    mfaRequired = mfaToken != null,
                    notice = notice,
                    noticeIsError = noticeIsError,
                    onCancelMfa = { mfaToken = null; notice = null; noticeIsError = false },
                    onSubmit = { username, password ->
                        scope.launch {
                            busy = true
                            notice = null
                            noticeIsError = false
                            when (val result = container.authRepository.login(username, password)) {
                                is ApiResult.Ok -> when (val outcome = result.data) {
                                    is LoginOutcome.Session -> {
                                        session = outcome.user
                                        mfaToken = null
                                        LocationScheduler.ensurePeriodic(context)
                                    }

                                    is LoginOutcome.MfaRequired -> {
                                        mfaToken = outcome.mfaToken
                                        notice = resources.getString(R.string.mfa_intro)
                                    }
                                }

                                is ApiResult.Err -> { notice = result.message; noticeIsError = true }
                            }
                            busy = false
                        }
                    },
                    onVerifyMfa = { code, trustDevice ->
                        val challenge = mfaToken ?: return@LoginScreen
                        scope.launch {
                            busy = true
                            notice = null
                            when (
                                val result = container.authRepository
                                    .verifyMfa(code, trustDevice, challenge)
                            ) {
                                is ApiResult.Ok -> {
                                    session = result.data
                                    mfaToken = null
                                    LocationScheduler.ensurePeriodic(context)
                                }

                                is ApiResult.Err -> { notice = result.message; noticeIsError = true }
                            }
                            busy = false
                        }
                    },
                )

            else -> AppShell(
                    container = container,
                    session = session!!,
                    notice = notice,
                    onNotice = { notice = it },
                    onLogout = {
                        scope.launch {
                            container.authRepository.logout()
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
