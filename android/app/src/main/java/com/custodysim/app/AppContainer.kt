package com.custodysim.app

import android.content.Context
import com.custodysim.app.data.auth.AuthRepository
import com.custodysim.app.data.auth.TokenStore
import com.custodysim.app.data.checkin.CheckinRepository
import com.custodysim.app.data.chat.ChatRepository
import com.custodysim.app.data.location.LocationRepository
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.portal.PortalRepository
import com.custodysim.app.data.task.TaskRepository
import com.custodysim.app.location.LocationCollector
import com.custodysim.app.location.PendingPointStore

/**
 * 依赖容器：进程内单例的唯一来源。
 *
 * 会话失效（401 且刷新失败）通过 [onSessionLost] 回调给 UI，
 * 由 UI 决定是回登录页还是提示，容器自己不持有界面状态。
 */
class AppContainer(context: Context) {

    private val appContext = context.applicationContext

    private var sessionLostListener: (() -> Unit)? = null

    val tokenStore = TokenStore(appContext)

    val apiClient = ApiClient(
        tokenStore = tokenStore,
        onSessionLost = { sessionLostListener?.invoke() },
    )

    val authRepository = AuthRepository(apiClient, tokenStore)

    val locationRepository = LocationRepository(apiClient)

    val checkinRepository = CheckinRepository(apiClient)

    val chatRepository = ChatRepository(apiClient)

    val taskRepository = TaskRepository(apiClient)

    val portalRepository = PortalRepository(apiClient)

    val pendingPointStore = PendingPointStore(appContext)

    val locationCollector = LocationCollector(appContext)

    /** 本地是否还留有可用的刷新令牌。 */
    suspend fun hasSession(): Boolean = tokenStore.refreshToken() != null

    fun observeSessionLoss(listener: (() -> Unit)?) {
        sessionLostListener = listener
    }
}
