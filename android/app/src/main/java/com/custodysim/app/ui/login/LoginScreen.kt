package com.custodysim.app.ui.login

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.input.nestedscroll.nestedScroll
import top.yukonga.miuix.kmp.icon.extended.Back
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.custodysim.app.R
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Contacts
import top.yukonga.miuix.kmp.icon.extended.Lock
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.ThemeController
import top.yukonga.miuix.kmp.theme.ColorSchemeMode
import top.yukonga.miuix.kmp.theme.defaultTextStyles
import top.yukonga.miuix.kmp.preference.SwitchPreference

/** Credentials are intentionally not persisted in saved instance state. */
@Composable
fun LoginScreen(
    onServerSettings: () -> Unit,
    busy: Boolean, mfaRequired: Boolean, notice: String?,
    noticeIsError: Boolean,
    retrySeconds: Long = 0,
    onSubmit: (username: String, password: String) -> Unit,
    onVerifyMfa: (code: String, trustDevice: Boolean) -> Unit,
    onCancelMfa: () -> Unit,
) {
    val dark = LocalDarkTheme.current
    val controller = remember(dark) {
        ThemeController(if (dark) ColorSchemeMode.Dark else ColorSchemeMode.Light)
    }
    MiuixTheme(controller = controller, textStyles = defaultTextStyles()) {
        LoginContent(onServerSettings, busy, mfaRequired, notice, noticeIsError,
            retrySeconds, onSubmit, onVerifyMfa, onCancelMfa)
    }
}

@Composable
private fun LoginContent(
    onServerSettings: () -> Unit,
    busy: Boolean, mfaRequired: Boolean, notice: String?,
    noticeIsError: Boolean,
    retrySeconds: Long,
    onSubmit: (username: String, password: String) -> Unit,
    onVerifyMfa: (code: String, trustDevice: Boolean) -> Unit,
    onCancelMfa: () -> Unit,
) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var trustDevice by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val haptics = LocalHapticFeedback.current
    val trustLabel = stringResource(R.string.trust_device)
    BackHandler(mfaRequired && !busy) { onCancelMfa() }
    LaunchedEffect(mfaRequired) { password = ""; code = ""; trustDevice = false }
    val canSubmit = !busy && retrySeconds == 0L && if (mfaRequired) code.trim().length >= 6
        else username.isNotBlank() && password.isNotBlank()
    val submit: () -> Unit = {
        if (canSubmit) {
            focus.clearFocus()
            if (mfaRequired) onVerifyMfa(code, trustDevice) else onSubmit(username, password)
        }
    }
    val scrollBehavior = MiuixScrollBehavior(rememberTopAppBarState())
    Scaffold(
        topBar = {
            TopAppBar(
                title = stringResource(if (mfaRequired) R.string.mfa_title else R.string.login),
                scrollBehavior = scrollBehavior,
                navigationIcon = {
                    if (mfaRequired) IconButton(onClick = onCancelMfa, enabled = !busy) {
                        Icon(MiuixIcons.Back, stringResource(R.string.back_to_login))
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()
            .nestedScroll(scrollBehavior.nestedScrollConnection)
            .verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth()
                .padding(horizontal = AppSpace.section, vertical = AppSpace.medium),
                verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                Text(stringResource(if (mfaRequired) R.string.mfa_intro else R.string.login_intro),
                    modifier = Modifier.padding(horizontal = AppSpace.tiny).padding(bottom = AppSpace.medium),
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                if (!mfaRequired) {
                    TextField(value = username, onValueChange = { username = it },
                        label = stringResource(R.string.username), enabled = !busy,
                        leadingIcon = { AuthFieldIcon(MiuixIcons.Contacts, Modifier.padding(start = AuthFieldIconInset)) },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                        insideMargin = AuthFieldInsideMargin,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                    TextField(value = password, onValueChange = { password = it },
                        label = stringResource(R.string.password), enabled = !busy,
                        leadingIcon = { AuthFieldIcon(MiuixIcons.Lock, Modifier.padding(start = AuthFieldIconInset)) },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                        insideMargin = AuthFieldInsideMargin,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }))
                } else {
                    TextField(value = code, onValueChange = { code = it },
                        label = stringResource(R.string.mfa_code), enabled = !busy,
                        leadingIcon = { AuthFieldIcon(MiuixIcons.Lock, Modifier.padding(start = AuthFieldIconInset)) },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                        insideMargin = AuthFieldInsideMargin,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }))
                    Card(Modifier.fillMaxWidth(), insideMargin = PaddingValues(0.dp)) {
                        SwitchPreference(title = trustLabel, summary = stringResource(R.string.trust_hint),
                            checked = trustDevice, enabled = !busy,
                            onCheckedChange = {
                                trustDevice = it
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            })
                    }
                }
                notice?.let { NoticeBanner(it, error = noticeIsError) }
                val actionLabel = if (retrySeconds > 0) stringResource(R.string.auth_retry_seconds, retrySeconds)
                    else stringResource(if (mfaRequired) R.string.verify else R.string.login)
                Spacer(Modifier.height(AppSpace.medium))
                Button(onClick = submit, enabled = canSubmit,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColorsPrimary(
                        disabledColor = if (busy) MiuixTheme.colorScheme.primary
                            else MiuixTheme.colorScheme.disabledPrimaryButton,
                        disabledContentColor = if (busy) MiuixTheme.colorScheme.onPrimary
                            else MiuixTheme.colorScheme.disabledOnPrimaryButton,
                    )) {
                    val transition = updateTransition(busy, label = "auth-submit-state")
                    val labelAlpha = transition.animateFloat(
                        transitionSpec = { tween(160) }, label = "auth-label-alpha",
                    ) { if (it) 0f else 1f }
                    val spinnerAlpha = transition.animateFloat(
                        transitionSpec = { tween(160) }, label = "auth-spinner-alpha",
                    ) { if (it) 1f else 0f }
                    // Both states share a measured area large enough for the entire spinner.
                    // Only opacity/scale animate; no intermediate size or clipping container.
                    Box(Modifier.heightIn(min = 26.dp), contentAlignment = Alignment.Center) {
                        Text(actionLabel, style = MiuixTheme.textStyles.button,
                            modifier = Modifier.graphicsLayer {
                                alpha = labelAlpha.value
                                scaleX = 0.88f + 0.12f * labelAlpha.value
                                scaleY = scaleX
                                clip = false
                            })
                        if (transition.currentState || transition.targetState) {
                            Box(Modifier.matchParentSize().graphicsLayer {
                                alpha = spinnerAlpha.value
                                scaleX = 0.88f + 0.12f * spinnerAlpha.value
                                scaleY = scaleX
                                clip = false
                            }, contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(
                                    size = 26.dp,
                                    colors = ProgressIndicatorDefaults.progressIndicatorColors(
                                        foregroundColor = MiuixTheme.colorScheme.onPrimary,
                                        backgroundColor = MiuixTheme.colorScheme.onPrimary.copy(alpha = 0.25f),
                                    ),
                                )
                            }
                        }
                    }
                }
                if (!mfaRequired) TextButton(text = stringResource(R.string.auth_server_settings),
                    enabled = !busy, onClick = onServerSettings,
                    modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

// Miuix leaves leading-icon spacing to the icon slot.
private val AuthFieldIconInset = AppSpace.small

private val AuthFieldInsideMargin = DpSize(20.dp, 16.dp)

@Composable
private fun AuthFieldIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier) {
    Box(modifier.padding(end = AppSpace.medium), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp),
            tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
    }
}
