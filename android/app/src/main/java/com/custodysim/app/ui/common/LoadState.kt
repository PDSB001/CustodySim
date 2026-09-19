package com.custodysim.app.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** 页面级数据的加载状态：所有只读页共用。 */
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val data: T) : LoadState<T>
    data class Failed(val message: String) : LoadState<Nothing>
}

/** 居中提示（加载中/空态共用）。 */
@Composable
fun CenterHint(text: String, modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, style = MiuixTheme.textStyles.footnote1)
    }
}

