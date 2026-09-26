package com.custodysim.app

import android.content.Context
import com.custodysim.app.data.auth.AuthRepository
import com.custodysim.app.data.auth.TokenStore
import com.custodysim.app.data.checkin.CheckinRepository
import com.custodysim.app.data.chat.ChatRealtimeClient
import com.custodysim.app.data.chat.ChatRepository
import com.custodysim.app.data.location.LocationRepository
import com.custodysim.app.data.net.ApiClient
import com.custodysim.app.data.portal.PortalRepository
import com.custodysim.app.data.task.TaskRepository
import com.custodysim.app.location.LocationCollector
import com.custodysim.app.location.PendingPointStore
import com.custodysim.app.location.LocationUploader

/**
 * 依赖容器：进程内单例的唯一来源。
 *
 * 会话失效（401 且刷新失败）通过 [ApiClient] 的回调通知 UI，
 * 由 UI 决定是回登录页还是提示，容器自己不持有界面状态。
 */
class AppContainer(context: Context, val endpoint: com.custodysim.app.config.ServerEndpoint =
    com.custodysim.app.config.ServerSettings(context).read()) {

    @Volatile var active = true
        private set

    private val appContext: Context = context.applicationContext

    private var sessionLostListener: (() -> Unit)? = null

    val tokenStore = TokenStore(appContext, endpoint.namespace)
    private val drafts = lazy { com.custodysim.app.data.draft.DraftStore(appContext) }
    val draftStore by drafts

    val apiClient by lazy { ApiClient(
        tokenStore = tokenStore,
        baseUrl = endpoint.baseUrl,
        onSessionLost = { sessionLostListener?.invoke() },
    ) }

    val authRepository by lazy { AuthRepository(apiClient, tokenStore) }

    val locationRepository by lazy { LocationRepository(apiClient) }

    val checkinRepository by lazy { CheckinRepository(apiClient) }

    val chatRepository by lazy { ChatRepository(apiClient) }

    /**
     * 聊天实时通道。
     *
     * 进程内共享一个实例：令牌由 [ChatRepository] 换取（复用同一套鉴权与 401 刷新），
     * 连接生命周期由聊天页在 STARTED 状态内驱动（进后台断开，省电）。
     */
    val chatRealtimeClient by lazy { ChatRealtimeClient(chatRepository::realtimeToken, endpoint.realtimeUrl) }

    val taskRepository by lazy { TaskRepository(apiClient) }

    val portalRepository by lazy { PortalRepository(apiClient) }

    val pendingPointStore = PendingPointStore(appContext, endpoint.namespace)

    val locationUploader by lazy {
        LocationUploader(pendingPointStore::snapshot, pendingPointStore::remove, locationRepository::reportBatch)
    }

    val locationCollector = LocationCollector(appContext)
    val locationReporting by lazy { com.custodysim.app.location.LocationReporting(appContext, this) }

    /** 本地是否还留有可用的刷新令牌。 */
    suspend fun hasSession(): Boolean = active && endpoint.baseUrl.isNotBlank() && tokenStore.refreshToken() != null

    suspend fun retire() {
        active = false
        sessionLostListener = null
        locationReporting.setEligible(false)
        apiClient.close()
        chatRealtimeClient.dispose()
        tokenStore.invalidate()
        pendingPointStore.discardAndClose()
        if (drafts.isInitialized()) draftStore.close()
    }

    fun observeSessionLoss(listener: (() -> Unit)?) {
        sessionLostListener = listener
    }
}
