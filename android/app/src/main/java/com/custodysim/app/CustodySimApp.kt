package com.custodysim.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.custodysim.app.config.ServerEndpoint
import com.custodysim.app.config.ServerSettings
import com.custodysim.app.location.LocationPreferences
import com.custodysim.app.location.LocationScheduler

/**
 * 应用入口。这里只做一件事：把依赖容器建起来。
 *
 * 没上 DI 框架（Hilt/Koin）：当前依赖图只有一层，手写容器更直观，
 * 也省掉注解处理器带来的构建复杂度。
 */
class CustodySimApp : Application() {

    private var current by mutableStateOf<AppContainer?>(null)
    val container: AppContainer get() = checkNotNull(current)
    private val switchMutex = Mutex()

    override fun onCreate() {
        super.onCreate()
        current = AppContainer(this)
    }

    suspend fun switchServer(origin: String) = switchMutex.withLock {
        val old = container
        val next = ServerEndpoint.selected(origin)
        if (next.baseUrl == old.endpoint.baseUrl) return@withLock
        // Finish a switch even if the initiating Activity is recreated midway.
        withContext(kotlinx.coroutines.NonCancellable) {
            try {
                LocationPreferences.setEnabled(this@CustodySimApp, false)
                old.retire()
                LocationScheduler.cancelAndAwait(this@CustodySimApp)
                withContext(Dispatchers.IO) { ServerSettings(this@CustodySimApp).save(next) }
            } finally {
                // A failed disk write returns to the previous origin with cleared credentials.
                withContext(Dispatchers.Main.immediate) { current = AppContainer(this@CustodySimApp) }
            }
        }
    }
}
