package com.custodysim.app.ui.login

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.*
import com.custodysim.app.R
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Contacts
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Credentials are intentionally not persisted in saved instance state. */
@Composable
fun LoginScreen(
    busy: Boolean, mfaRequired: Boolean, notice: String?,
    noticeIsError: Boolean,
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
    val canSubmit = !busy && if (mfaRequired) code.trim().length >= 6
        else username.isNotBlank() && password.isNotBlank()
    val submit: () -> Unit = {
        if (canSubmit) {
            focus.clearFocus()
            if (mfaRequired) onVerifyMfa(code, trustDevice) else onSubmit(username, password)
        }
    }
    Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = AppSpace.contentWidth).fillMaxSize()
                .verticalScroll(rememberScrollState()).padding(AppSpace.section),
            verticalArrangement = Arrangement.spacedBy(AppSpace.section),
        ) {
            Spacer(Modifier.height(AppSpace.large))
            Icon(MiuixIcons.Contacts, null, modifier = Modifier.size(AppSpace.large),
                tint = MiuixTheme.colorScheme.primary)
            Column(verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                Text(stringResource(if (mfaRequired) R.string.mfa_title else R.string.app_name),
                    style = MiuixTheme.textStyles.title1)
                Text(stringResource(if (mfaRequired) R.string.mfa_intro else R.string.login_intro),
                    style = MiuixTheme.textStyles.body1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
            SettingGroup {
                Column(Modifier.padding(AppSpace.inset), verticalArrangement = Arrangement.spacedBy(AppSpace.page)) {
                    if (!mfaRequired) {
                        TextField(value = username, onValueChange = { username = it },
                            label = stringResource(R.string.username), enabled = !busy,
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
                        TextField(value = password, onValueChange = { password = it },
                            label = stringResource(R.string.password), enabled = !busy,
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }))
                    } else {
                        TextField(value = code, onValueChange = { code = it },
                            label = stringResource(R.string.mfa_code), enabled = !busy,
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }))
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(AppSpace.page)) {
                            Column(Modifier.weight(1f)) {
                                Text(trustLabel, style = MiuixTheme.textStyles.body1)
                                Text(stringResource(R.string.trust_hint), style = MiuixTheme.textStyles.footnote1,
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            }
                            Switch(checked = trustDevice, enabled = !busy,
                                modifier = Modifier.semantics { contentDescription = trustLabel },
                                onCheckedChange = {
                                    trustDevice = it
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                })
                        }
                    }
                }
            }
            notice?.let { NoticeBanner(it, error = noticeIsError) }
            PrimaryAction(text = stringResource(
                if (mfaRequired) { if (busy) R.string.verifying else R.string.verify }
                else { if (busy) R.string.logging_in else R.string.login }),
                busy = busy, enabled = canSubmit, onClick = submit)
            if (mfaRequired) TextButton(text = stringResource(R.string.back_to_login),
                enabled = !busy, onClick = onCancelMfa, modifier = Modifier.fillMaxWidth())
        }
    }
}
