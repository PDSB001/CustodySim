package com.custodysim.app.data.auth

import android.content.Context
import android.util.Log
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val Context.authDataStore by preferencesDataStore(name = "auth")

/**
 * 令牌与可信设备的本地存储。
 *
 * 全部经 [KeystoreCipher] 加密后再落 DataStore，不写日志、不进外部存储；
 * 应用的 `allowBackup=false` 也保证了它不会被备份带走。
 */
class TokenStore(private val context: Context, namespace: String = "") {
    @Volatile private var closed = false

    private companion object {
        const val TAG = "CustodySim.Token"
    }

    private class TokenKeys(namespace: String) {
        private val prefix = if (namespace.isEmpty()) "" else "$namespace:"
        val accessToken = stringPreferencesKey("${prefix}access_token")
        val refreshToken = stringPreferencesKey("${prefix}refresh_token")
        val trustedDevice = stringPreferencesKey("${prefix}trusted_device")
    }

    private val keys = TokenKeys(namespace)

    suspend fun invalidate() { closed = true; clear() }

    suspend fun saveTokens(accessToken: String, refreshToken: String) {
        val (encryptedAccess, encryptedRefresh) = withContext(Dispatchers.IO) {
            KeystoreCipher.encrypt(context, accessToken) to KeystoreCipher.encrypt(context, refreshToken)
        }
        Log.d(TAG, "saveTokens encryptAccess=${encryptedAccess != null} encryptRefresh=${encryptedRefresh != null}")
        if (encryptedAccess == null || encryptedRefresh == null) return
        context.authDataStore.edit { prefs ->
            if (closed) return@edit
            prefs[keys.accessToken] = encryptedAccess
            prefs[keys.refreshToken] = encryptedRefresh
        }
        Log.d(TAG, "saveTokens written")
    }

    suspend fun accessToken(): String? = read(keys.accessToken)

    suspend fun refreshToken(): String? = read(keys.refreshToken)

    /** 可信设备值形如 `<deviceId>.<token>`，服务端签发后由客户端在登录时回传。 */
    suspend fun saveTrustedDevice(value: String?) {
        context.authDataStore.edit { prefs ->
            if (closed) return@edit
            if (value.isNullOrBlank()) {
                prefs.remove(keys.trustedDevice)
            } else {
                withContext(Dispatchers.IO) { KeystoreCipher.encrypt(context, value) }
                    ?.let { prefs[keys.trustedDevice] = it }
            }
        }
    }

    suspend fun trustedDevice(): String? = read(keys.trustedDevice)

    /** 清空凭证。可信设备**一并清除**：改密后服务端已撤销全部信任设备。 */
    suspend fun clear() {
        context.authDataStore.edit { prefs -> prefs.remove(keys.accessToken); prefs.remove(keys.refreshToken); prefs.remove(keys.trustedDevice) }
    }

    private suspend fun read(key: androidx.datastore.preferences.core.Preferences.Key<String>): String? {
        if (closed) return null
        val stored = context.authDataStore.data.first()[key]
        if (stored == null) {
            Log.d(TAG, "read ${key.name}: not stored")
            return null
        }
        val decrypted = withContext(Dispatchers.IO) { KeystoreCipher.decrypt(context, stored) }
        Log.d(TAG, "read ${key.name}: storedLen=${stored.length} decrypted=${decrypted != null}")
        return decrypted
    }
}
