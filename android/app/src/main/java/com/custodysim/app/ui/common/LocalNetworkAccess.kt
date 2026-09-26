package com.custodysim.app.ui.common

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

/** Gate LAN development connections before session restoration; release never requests this permission. */
@Composable
fun LocalNetworkAccess(required: Boolean, onServerSettings: () -> Unit, content: @Composable () -> Unit) {
    if (!required || Build.VERSION.SDK_INT < 37) {
        content()
        return
    }
    val context = LocalContext.current
    fun hasAccess() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_LOCAL_NETWORK) ==
        PackageManager.PERMISSION_GRANTED
    var granted by remember { mutableStateOf(hasAccess()) }
    var denied by remember { mutableStateOf(false) }
    val settings = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        granted = hasAccess()
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        denied = !it
    }
    if (granted) {
        content()
    } else {
        Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
            Column {
            PageState(
                title = "允许连接联调服务器",
                description = if (denied) "局域网访问未获授权。点击重试，在应用权限设置中允许访问附近设备。"
                    else "当前联调包连接局域网服务器，需要允许访问附近设备。授权后继续登录。",
                onRetry = {
                    if (denied) settings.launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        "package:${context.packageName}".toUri()))
                    else request.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
                },
            )
            top.yukonga.miuix.kmp.basic.TextButton(text = "更换服务器", onClick = onServerSettings)
            }
        }
    }
}
