package com.custodysim.app.ui.common

import androidx.compose.runtime.*
import com.custodysim.app.AppContainer
import kotlinx.coroutines.CancellationException

val LocalDraftOwner = staticCompositionLocalOf<String> { error("Draft owner missing") }

@Stable
class FormDraft(private val save: (Map<String, Any?>) -> Unit) {
    var values by mutableStateOf<Map<String, Any?>>(emptyMap())
        private set
    var ready by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        internal set
    internal fun restore(value: Map<String, Any?>) { values = value; ready = true }
    fun replace(value: Map<String, Any?>) {
        if (!ready) return
        values = value.toMap()
        save(values)
    }
    fun set(key: String, value: Any?) = replace(values + (key to value))
    fun clear() = replace(emptyMap())
    // Keep rendered content stable until the sheet's exit animation has finished.
    fun submitted() { if (ready) save(emptyMap()) }
}

@Composable
fun rememberFormDraft(container: AppContainer, form: String): FormDraft {
    val owner = LocalDraftOwner.current
    val key = "${container.endpoint.baseUrl}|$owner|$form"
    val draft = remember(key) { FormDraft { container.draftStore.save(key, it) } }
    LaunchedEffect(draft) {
        try { draft.restore(container.draftStore.read(key)) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { draft.error = "无法读取本地草稿，请稍后重试" }
    }
    LaunchedEffect(draft) {
        container.draftStore.errors.collect { failures ->
            if (draft.ready) draft.error = failures[key]
        }
    }
    return draft
}
