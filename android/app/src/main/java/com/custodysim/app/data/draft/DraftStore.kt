package com.custodysim.app.data.draft

import android.content.Context
import android.util.AtomicFile
import com.custodysim.app.data.auth.KeystoreCipher
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Process-owned writer: leaving a screen does not cancel a pending draft save. */
class DraftStore(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private val pending = Channel<Pair<String, Map<String, Any?>>>(Channel.UNLIMITED)
    private val cache = java.util.concurrent.ConcurrentHashMap<String, Map<String, Any?>>()
    val errors = MutableStateFlow<Map<String, String>>(emptyMap())
    private val files = File(context.noBackupFilesDir, "form-drafts")

    private val writer = scope.launch {
            for (first in pending) {
                val latest = linkedMapOf(first)
                while (true) {
                    val next = pending.tryReceive().getOrNull() ?: break
                    latest[next.first] = next.second
                }
                for ((key, value) in latest) mutex.withLock {
                    // A failed save is retained in memory and reported on the next read.
                    try { write(key, value) } catch (_: Exception) {
                        errors.update { it + (key to "本地草稿保存失败，请保留页面并重试") }
                    }
                }
            }
    }

    suspend fun close() { pending.close(); writer.join(); scope.cancel() }

    suspend fun read(key: String): Map<String, Any?> = withContext(Dispatchers.IO) {
        mutex.withLock {
            cache[key] ?: run {
                val file = file(key)
                val value = try {
                    val encrypted = file.openRead().bufferedReader().use { it.readText() }
                    val json = KeystoreCipher.decrypt(context, encrypted) ?: error("草稿解密失败")
                    decode(JSONObject(json))
                } catch (_: java.io.FileNotFoundException) { emptyMap() }
                cache.putIfAbsent(key, value) ?: value
            }
        }
    }

    fun save(key: String, value: Map<String, Any?>) {
        cache[key] = value.toMap()
        pending.trySend(key to value.toMap())
    }

    private fun file(key: String): AtomicFile {
        val name = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
            .joinToString("") { "%02x".format(it) }
        return AtomicFile(File(files, name))
    }
    private fun write(key: String, value: Map<String, Any?>) {
        val file = file(key)
        if (value.isEmpty()) { file.delete(); errors.update { it - key }; return }
        check(files.exists() || files.mkdirs())
        val encrypted = KeystoreCipher.encrypt(context, JSONObject(value).toString()) ?: error("草稿加密失败")
        val stream = file.startWrite()
        try {
            stream.write(encrypted.toByteArray())
            file.finishWrite(stream)
            errors.update { it - key }
        } catch (error: Exception) { file.failWrite(stream); throw error }
    }

    private fun decode(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { key ->
        val value: Any? = json.opt(key)
        if (value == null || value === JSONObject.NULL) null
        else if (value is JSONArray) List(value.length()) { value.opt(it) }
        else value
    }
}
