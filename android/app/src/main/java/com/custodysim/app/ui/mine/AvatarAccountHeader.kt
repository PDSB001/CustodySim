package com.custodysim.app.ui.mine

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.auth.SessionUser
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.roleLabel
import com.custodysim.app.ui.theme.AppSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun AvatarAccountHeader(container: AppContainer, session: SessionUser) {
    var avatar by remember(session.id) { mutableStateOf(session.avatar) }
    var draft by remember { mutableStateOf<String?>(null) }
    var visible by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var cropSource by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val snackbar = LocalAppSnackbar.current
    LaunchedEffect(session.id) {
        val result = container.apiClient.get("/api/me")
        if (result is ApiResult.Ok) avatar = SessionUser.from(result.data).avatar
    }
    val pick = rememberImagePicker { images -> scope.launch {
        busy = true
        try { cropSource = images.firstOrNull() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { snackbar("图片处理失败，请重新选择") }
        finally { busy = false }
    } }
    Row(Modifier.fillMaxWidth().clickable { draft = avatar; cropSource = null; visible = true }.padding(AppSpace.inset),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AppSpace.page)) {
        UserAvatar(session.name, avatar, size = 64.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(session.name, style = MiuixTheme.textStyles.title2)
            Text(roleLabel(session.role), color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            Text("设置头像", style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary)
        }
    }
    OverlaySheet(show = visible, title = if (cropSource == null) "设置头像" else "裁剪头像", busy = busy, onDismiss = { visible = false }) {
        Column(Modifier.fillMaxWidth().padding(AppSpace.page), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(AppSpace.page)) {
            val source = cropSource
            if (source != null) {
                AvatarCropper(source, onCancel = { cropSource = null }, onConfirm = { draft = it; cropSource = null })
            } else {
            UserAvatar(session.name, draft, size = 104.dp)
            Text("选择图片后可调整裁剪，保存后同步到双端", style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            Row(horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                TextButton(text = "选择图片", enabled = !busy, onClick = pick)
                TextButton(text = "恢复默认", enabled = !busy && draft != null, onClick = { draft = null })
            }
            PrimaryAction(if (busy) "处理中…" else "保存头像", busy = busy, onClick = {
                if (busy) return@PrimaryAction
                scope.launch {
                    busy = true
                    try {
                        when (val result = container.apiClient.patch("/api/me/avatar", JSONObject().put("avatar", draft ?: JSONObject.NULL))) {
                            is ApiResult.Ok -> { avatar = draft; visible = false; snackbar("头像已更新") }
                            is ApiResult.Err -> snackbar(result.message)
                        }
                    } finally { busy = false }
                }
            })
            }
        }
    }
}
