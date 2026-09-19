package com.custodysim.app.data.auth

import android.content.Context
import android.util.Log
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.authDataStore by preferencesDataStore(name = "auth")

/**
 * 令牌与可信设备的本地存储。
 *
 * 全部经 [KeystoreCipher] 加密后再落 DataStore，不写日志、不进外部存储；
 * 应用的 `allowBackup=false` 也保证了它不会被备份带走。
 */
class TokenStore(private val context: Context) {

    private companion object {
        const val TAG = "CustodySim.Token"
    }

    private object Keys {
        val accessToken = stringPreferencesKey("access_token")
        val refreshToken = stringPreferencesKey("refresh_token")
        val trustedDevice = stringPreferencesKey("trusted_device")
    }

    suspend fun saveTokens(accessToken: String, refreshToken: String) {
        val encryptedAccess = KeystoreCipher.encrypt(context, accessToken)
        val encryptedRefresh = KeystoreCipher.encrypt(context, refreshToken)
        Log.d(TAG, "saveTokens encryptAccess=${encryptedAccess != null} encryptRefresh=${encryptedRefresh != null}")
        if (encryptedAccess == null || encryptedRefresh == null) return
        context.authDataStore.edit { prefs ->
            prefs[Keys.accessToken] = encryptedAccess
            prefs[Keys.refreshToken] = encryptedRefresh
        }
        Log.d(TAG, "saveTokens written")
    }

    suspend fun accessToken(): String? = read(Keys.accessToken)

    suspend fun refreshToken(): String? = read(Keys.refreshToken)

    /** 可信设备值形如 `<deviceId>.<token>`，服务端签发后由客户端在登录时回传。 */
    suspend fun saveTrustedDevice(value: String?) {
        context.authDataStore.edit { prefs ->
            if (value.isNullOrBlank()) {
                prefs.remove(Keys.trustedDevice)
            } else {
                KeystoreCipher.encrypt(context, value)?.let { prefs[Keys.trustedDevice] = it }
            }
        }
    }

    suspend fun trustedDevice(): String? = read(Keys.trustedDevice)

    /** 清空凭证。可信设备**一并清除**：改密后服务端已撤销全部信任设备。 */
    suspend fun clear() {
        context.authDataStore.edit { prefs -> prefs.clear() }
    }

    private suspend fun read(key: androidx.datastore.preferences.core.Preferences.Key<String>): String? {
        val stored = context.authDataStore.data.first()[key]
        if (stored == null) {
            Log.d(TAG, "read ${key.name}: not stored")
            return null
        }
        val decrypted = KeystoreCipher.decrypt(context, stored)
        Log.d(TAG, "read ${key.name}: storedLen=${stored.length} decrypted=${decrypted != null}")
        return decrypted
    }
}
