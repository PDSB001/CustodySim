package com.custodysim.app.ui.common

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.custodysim.app.data.media.ImagePipeline
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** 系统相册选图 + 压缩成 data URL 的统一入口。返回触发函数，选中后压缩并回调。 */
@Composable
fun rememberImagePicker(
    maxItems: Int = 1,
    onProcessingChanged: (Boolean) -> Unit = {},
    onPicked: (List<String>) -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentOnPicked by rememberUpdatedState(onPicked)
    val currentOnProcessingChanged by rememberUpdatedState(onProcessingChanged)
    val currentSnackbar by rememberUpdatedState(LocalAppSnackbar.current)

    val processPicked: (List<Uri>) -> Unit = { uris ->
        if (uris.isNotEmpty()) {
            scope.launch {
                currentOnProcessingChanged(true)
                try {
                    val urls = uris.mapNotNull { uri ->
                        try {
                            ImagePipeline.compressToDataUrl(context, uri)
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            null
                        }
                    }
                    if (urls.isNotEmpty()) currentOnPicked(urls)
                    else currentSnackbar("图片处理失败，请重新选择")
                } finally {
                    currentOnProcessingChanged(false)
                }
            }
        }
    }

    val single = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) processPicked(listOf(uri))
    }

    val multiple = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(maxItems.coerceAtLeast(2)),
    ) { uris ->
        processPicked(uris)
    }

    return {
        val request = PickVisualMediaRequest(
            ActivityResultContracts.PickVisualMedia.ImageOnly,
        )
        if (maxItems <= 1) single.launch(request) else multiple.launch(request)
    }
}
