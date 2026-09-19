package com.custodysim.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.navigationevent.compose.LocalNavigationEventDispatcherOwner
import androidx.navigationevent.compose.rememberNavigationEventDispatcherOwner
import com.custodysim.app.ui.AppRoot
import com.custodysim.app.ui.theme.CustodySimTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as CustodySimApp).container
        setContent {
            CustodySimTheme {
                // MiuiX 的 OverlayBottomSheet/OverlayDialog 内部走 NavigationBackHandler，
                // 必须提供一个 NavigationEventDispatcherOwner，否则弹层会直接崩。
                val dispatcherOwner = rememberNavigationEventDispatcherOwner(parent = null)
                CompositionLocalProvider(LocalNavigationEventDispatcherOwner provides dispatcherOwner) {
                    AppRoot(container)
                }
            }
        }
    }
}
