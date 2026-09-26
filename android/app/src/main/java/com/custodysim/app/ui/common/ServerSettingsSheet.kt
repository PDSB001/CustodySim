package com.custodysim.app.ui.common

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.navigationevent.NavigationEventInfo
import androidx.navigationevent.compose.NavigationBackHandler
import androidx.navigationevent.compose.rememberNavigationEventState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import com.custodysim.app.config.ServerEndpoint
import com.custodysim.app.config.ServerProbe
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun ServerSettingsSheet(show: Boolean, current: String, onDismiss: () -> Unit, onSwitch: suspend (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf(current) }
    var verified by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val backState = rememberNavigationEventState(currentInfo = NavigationEventInfo.None)
    NavigationBackHandler(
        state = backState,
        isBackEnabled = show,
        onBackCompleted = { if (!busy) onDismiss() },
    )
    LaunchedEffect(show, current) {
        if (show) { address = current; verified = null; message = null; error = false }
    }
    OverlaySheet(show, "服务器设置", onDismiss, busy = busy) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(AppSpace.page),
            verticalArrangement = Arrangement.spacedBy(AppSpace.page)) {
            Text("当前服务器", style = MiuixTheme.textStyles.footnote1)
            Text(current.ifBlank { "尚未设置" }, style = MiuixTheme.textStyles.body2)
            FramedTextField(value = address, onValueChange = { address = it; verified = null; message = null },
                label = "服务器地址，例如 https://example.com", enabled = !busy,
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            Text("请只填写你信任的服务器。检测不会发送账号或密码。首版支持公网 HTTPS 根地址，聊天自动连接同域服务。",
                style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            message?.let { NoticeBanner(it, error) }
            PrimaryAction("检测连接", busy = busy, enabled = address.isNotBlank()) {
                scope.launch {
                    busy = true; verified = null; message = null
                    try {
                        val origin = ServerEndpoint.normalize(address)
                        val version = ServerProbe.check(origin)
                        verified = origin; error = false
                        message = "已连接 CustodySim $version，协议兼容。保存后仍需登录；实时聊天需服务端正确配置。"
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { error = true; message = failure.message ?: "检测失败，请稍后重试" }
                    finally { busy = false }
                }
            }
            Text("切换会退出本机旧会话并清除旧登录凭据，停止旧服务器的聊天与定位任务。尚未上传的位置将清除，已上传记录不受影响；草稿按服务器保留。后台位置上报将关闭，登录后按需重新开启。",
                style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            PrimaryAction("确认切换并重新登录", busy = busy, enabled = verified != null && verified != current) {
                val origin = verified ?: return@PrimaryAction
                scope.launch {
                    busy = true
                    try { onSwitch(origin); onDismiss() }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { error = true; message = "切换未完成，请重新检测并重试" }
                    finally { busy = false }
                }
            }
        }
    }
}
