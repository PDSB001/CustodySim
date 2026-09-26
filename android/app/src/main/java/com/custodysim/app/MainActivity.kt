package com.custodysim.app

import android.os.Bundle
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.*
import androidx.navigationevent.compose.LocalNavigationEventDispatcherOwner
import androidx.navigationevent.compose.rememberNavigationEventDispatcherOwner
import androidx.navigationevent.OnBackInvokedDefaultInput
import com.custodysim.app.ui.AppRoot
import com.custodysim.app.ui.common.LocalNetworkAccess
import com.custodysim.app.ui.common.ServerSettingsSheet
import com.custodysim.app.ui.theme.CustodySimTheme
import top.yukonga.miuix.kmp.basic.Scaffold

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as CustodySimApp
        setContent {
            val container = app.container
            var serverSettings by remember { mutableStateOf(false) }
            CustodySimTheme {
                // MiuiX 的 OverlayBottomSheet/OverlayDialog 内部走 NavigationBackHandler，
                // 必须提供一个 NavigationEventDispatcherOwner，否则弹层会直接崩。
                val dispatcherOwner = rememberNavigationEventDispatcherOwner(parent = null)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val backInput = remember(dispatcherOwner) {
                        OnBackInvokedDefaultInput(onBackInvokedDispatcher)
                    }
                    DisposableEffect(dispatcherOwner, backInput) {
                        dispatcherOwner.navigationEventDispatcher.addInput(backInput)
                        onDispose { dispatcherOwner.navigationEventDispatcher.removeInput(backInput) }
                    }
                }
                CompositionLocalProvider(LocalNavigationEventDispatcherOwner provides dispatcherOwner) {
                    // OverlayBottomSheet registers with the nearest/root Miuix Scaffold.
                    // Keep the host outside session/container replacement, including login and LAN gates.
                    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0)) { _ ->
                        key(container) {
                            LocalNetworkAccess(required = container.endpoint.namespace.isEmpty() && BuildConfig.NEEDS_LOCAL_NETWORK,
                                onServerSettings = { serverSettings = true }) {
                                AppRoot(container, onServerSettings = { serverSettings = true })
                            }
                        }
                        ServerSettingsSheet(serverSettings, container.endpoint.baseUrl,
                            onDismiss = { serverSettings = false }, onSwitch = app::switchServer)
                    }
                }
            }
        }
    }
}
