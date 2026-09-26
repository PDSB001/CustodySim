package com.custodysim.app.data.auth

import android.content.Context
import android.annotation.SuppressLint
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 字符串加解密：首选 Android Keystore 的 AES-GCM，失败时降级到软件 AES-GCM。
 *
 * 某些环境（小米 TEESimulator、模拟器）里 Keystore 的 AES 密钥一生成就被
 * `KeyPermanentlyInvalidatedException` 标记失效，此时若只依赖 Keystore 会导致
 * 令牌永远写不进 DataStore。降级路径用派生自设备 ANDROID_ID 的软件密钥，密文
 * 带前缀（`k:` Keystore / `s:` 软件）区分，解密时按前缀走对应路径。
 *
 * 真实设备上 Keystore 正常，依然走首选加密路径；降级只在 Keystore 不可用时触发。
 */
internal object KeystoreCipher {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "custodysim.token.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12
    private const val SOFTWARE_SALT = "custodysim.software-aes.v1"
    private const val PREFIX_KEYSTORE = "k:"
    private const val PREFIX_SOFTWARE = "s:"
    private const val TAG = "CustodySim.Crypto"

    fun encrypt(context: Context, plain: String): String? {
        keystoreEncrypt(plain)?.let { return PREFIX_KEYSTORE + it }
        Log.w(TAG, "Keystore unavailable, falling back to software AES")
        return softwareEncrypt(context, plain)?.let { PREFIX_SOFTWARE + it }
    }

    fun decrypt(context: Context, stored: String): String? = when {
        stored.startsWith(PREFIX_KEYSTORE) ->
            keystoreDecrypt(stored.substring(PREFIX_KEYSTORE.length))

        stored.startsWith(PREFIX_SOFTWARE) ->
            softwareDecrypt(context, stored.substring(PREFIX_SOFTWARE.length))

        // 旧格式（无前缀）兼容：先按 Keystore 解，失败再试软件。
        else -> keystoreDecrypt(stored) ?: softwareDecrypt(context, stored)
    }

    // ---- Keystore AES-GCM（首选） ----

    private fun keystoreEncrypt(plain: String): String? = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keystoreKey())
        Base64.encodeToString(
            cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
    } catch (error: Exception) {
        Log.d(TAG, "keystore encrypt failed: ${error.javaClass.name}")
        null
    }

    private fun keystoreDecrypt(stored: String): String? = try {
        val payload = Base64.decode(stored, Base64.NO_WRAP)
        if (payload.size <= GCM_IV_BYTES) {
            null
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                keystoreKey(),
                GCMParameterSpec(GCM_TAG_BITS, payload, 0, GCM_IV_BYTES),
            )
            String(
                cipher.doFinal(payload, GCM_IV_BYTES, payload.size - GCM_IV_BYTES),
                Charsets.UTF_8,
            )
        }
    } catch (_: Exception) {
        null
    }

    private fun keystoreKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    // ---- 软件 AES-GCM（降级） ----

    private fun softwareEncrypt(context: Context, plain: String): String? = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, softwareKey(context))
        Base64.encodeToString(
            cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
    } catch (error: Exception) {
        Log.e(TAG, "software encrypt failed", error)
        null
    }

    private fun softwareDecrypt(context: Context, stored: String): String? = try {
        val payload = Base64.decode(stored, Base64.NO_WRAP)
        if (payload.size <= GCM_IV_BYTES) {
            null
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                softwareKey(context),
                GCMParameterSpec(GCM_TAG_BITS, payload, 0, GCM_IV_BYTES),
            )
            String(
                cipher.doFinal(payload, GCM_IV_BYTES, payload.size - GCM_IV_BYTES),
                Charsets.UTF_8,
            )
        }
    } catch (_: Exception) {
        null
    }

    // Existing s: ciphertext derives its key from this ID. Changing it would lose stored credentials.
    // Used locally for legacy encryption compatibility, never sent as a device identifier.
    @SuppressLint("HardwareIds")
    private fun softwareKey(context: Context): SecretKey {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID,
        ) ?: "unknown"
        val raw = MessageDigest.getInstance("SHA-256")
            .digest("$SOFTWARE_SALT:$androidId".toByteArray(Charsets.UTF_8))
        return SecretKeySpec(raw, "AES")
    }
}
